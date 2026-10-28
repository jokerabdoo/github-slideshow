// Real Chromium DOM + extension background/page code, with Chrome APIs shimmed.
// This environment's browser policy forbids loading unpacked extensions.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const fixture = `<!doctype html><html><body><main><div id="messages"></div><textarea id="input"></textarea><button id="send">Send</button><button id="stop" hidden>Stop</button></main><script>
    window.sent=[];
    window.stopClicks=0;document.querySelector('#stop').onclick=()=>{window.stopClicks++;document.querySelector('#stop').hidden=true;};
    document.querySelector('#send').onclick=()=>{
      const input=document.querySelector('#input');
      window.sent.push(input.value); input.value=''; input.dispatchEvent(new Event('input',{bubbles:true}));
      const reply=document.createElement('div'); reply.className='assistant'; reply.textContent='Thinking';
      document.querySelector('#messages').append(reply); document.querySelector('#stop').hidden=false;
      setTimeout(()=>{reply.textContent='Reply '+location.pathname+' '+window.sent.length; document.querySelector('#stop').hidden=true;},150);
    };
    </script></body></html>`;
  const root=path.join(__dirname,'../extension');
  const server = http.createServer((req,res)=>{
    if(req.url==='/assets/report.pdf'){res.setHeader('Content-Type','application/pdf');res.end('%PDF-1.4\nfixture\n%%EOF');return;}
    if(req.url.startsWith('/extension/')) {
      const name=path.basename(req.url);
      res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
      res.end(fs.readFileSync(path.join(root,name)));return;
    }
    res.setHeader('Content-Type','text/html');res.end(fixture);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  const realNow=Date.now;
  let clock=0;
  try {
    browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:640,height:1000}});
    const errors=[];context.on('weberror',e=>errors.push(e.error().message));
    const base='http://127.0.0.1:'+server.address().port;
    const pages=new Map([[1,await context.newPage()],[2,await context.newPage()]]);
    const a=pages.get(1), b=pages.get(2);
    await a.goto(base+'/a');await b.goto(base+'/b');
    const data={}, handlers=[];let startup;
    const get=async key=>key===null?structuredClone(data):{[key]:structuredClone(data[key])};
    const set=async values=>{Object.assign(data,structuredClone(values));};
    const tabInfo=id=>({id,url:pages.get(id).url(),title:'Chat '+id});
    globalThis.chrome={
      storage:{local:{get,set}},
      tabs:{get:async id=>tabInfo(id),query:async()=>[tabInfo(1),tabInfo(2)],update:async()=>{},sendMessage:async(id,message)=>pages.get(id).evaluate(message=>new Promise(resolve=>{
        const listener=globalThis.contentListener;
        if(!listener)throw Error('No content listener');
        listener(message,{},resolve);
      }),message)},
      scripting:{executeScript:async({target})=>{
        const p=pages.get(target.tabId);
        await p.evaluate(()=>{globalThis.chrome={runtime:{onMessage:{addListener:fn=>{globalThis.contentListener=fn;}},sendMessage:async()=>({})}};});
        for(const name of ['detect.js','media.js','page.js'])await p.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
      }},
      alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:()=>{}}},
      action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
      permissions:{contains:async()=>false},
      runtime:{onMessage:{addListener:fn=>handlers.push(fn)},onStartup:{addListener:fn=>{startup=fn;}}}
    };
    await import('../extension/background.js');
    const command=message=>new Promise((resolve,reject)=>handlers[0](message,{},response=>response.ok?resolve(response.result):reject(Error(response.error))));
    const getRun=()=>structuredClone(data.run);
    Date.now=()=>realNow()+clock;
    const profile={input:'#input',reply:'.assistant',send:'#send',busy:'#stop:not([hidden])'};
    await command({type:'saveProfile',id:1,profile});
    await command({type:'start',a:1,b:2,limit:4,seed:'Opening task',existing:false});
    assert.deepEqual(await a.evaluate(()=>window.sent),['Opening task']);
    async function settle(){
      await new Promise(r=>setTimeout(r,250));
      await command({type:'tick'});clock+=9000;await command({type:'tick'});
    }
    await settle();assert.deepEqual(await b.evaluate(()=>window.sent),['Reply /a 1']);
    await settle();assert.deepEqual(await a.evaluate(()=>window.sent),['Opening task','Reply /b 1']);
    await settle();let run=getRun();assert.equal(run.status,'done');assert.equal(run.sent,4);
    assert.deepEqual(await b.evaluate(()=>window.sent),['Reply /a 1','Reply /a 2']);
    console.log('PASS: background + actual page scripts relay A → B → A → B and stop at the limit');

    await new Promise(r=>setTimeout(r,250));
    await command({type:'start',a:1,b:2,limit:5,existing:true});
    await b.locator('#input').fill('A human draft');
    await settle();assert.equal(getRun().status,'paused');assert.equal(await b.locator('#input').inputValue(),'A human draft');
    console.log('PASS: receiving draft is preserved and pauses the relay');
    await b.locator('#input').fill('');

    await command({type:'start',a:1,b:2,limit:5,existing:true});
    await a.locator('#stop').evaluate(el=>el.hidden=false);
    await settle();assert.equal(getRun().sent,0);
    await a.locator('#stop').evaluate(el=>el.hidden=true);
    await command({type:'stop'});await settle();assert.equal(getRun().status,'stopped');
    console.log('PASS: streaming replies are not forwarded; Stop prevents future sends');

    await command({type:'start',a:1,b:2,limit:5,existing:true});
    await a.goto(base+'/another-conversation');await command({type:'tick'});assert.equal(getRun().status,'paused');
    console.log('PASS: navigation pauses before forwarding');

    await a.goto(base+'/a');
    await command({type:'start',a:1,b:2,limit:5,seed:'Another task',existing:false});
    data.run.phase='sending';const before=await b.evaluate(()=>window.sent.length);
    await command({type:'tick'});assert.equal(getRun().status,'paused');assert.equal(await b.evaluate(()=>window.sent.length),before);
    console.log('PASS: uncertain delivery pauses without retrying');

    await new Promise(r=>setTimeout(r,250));
    await command({type:'start',a:1,b:2,limit:5,existing:true});
    const repeated=await a.locator('.assistant').last().innerText();
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('0:'+repeated));
    data.run.seen=[Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('')];
    await settle();assert.equal(getRun().status,'paused');assert.match(getRun().note,/Repeated reply/);
    console.log('PASS: a repeated source reply is detected without resending');

    await b.evaluate(()=>{chrome.runtime.sendMessage=async message=>{window.picked=message;return {};};});
    await chrome.tabs.sendMessage(2,{type:'pick',role:'reply'});
    await b.locator('.assistant').last().click();
    const picked=await b.evaluate(()=>window.picked);
    assert.equal(picked.selector,'div.assistant');assert.equal(picked.role,'reply');
    console.log('PASS: page picker selects a reusable assistant-message selector');

    // Exercise ChatGPT-style rich editors as well as textarea-backed chats.
    await b.evaluate(()=>{
      document.querySelector('#input').outerHTML='<div id="input" contenteditable="true"></div>';
      document.querySelector('#send').onclick=()=>{
        const input=document.querySelector('#input');window.sent.push(input.innerText);input.replaceChildren();
      };
    });
    const richText='<script>do not execute</script>\nHello from a rich editor';
    const richResult=await chrome.tabs.sendMessage(2,{type:'send',profile,text:richText});
    assert.equal(richResult.ok,true,richResult.error);
    assert.equal((await b.evaluate(()=>window.sent)).at(-1),richText);
    assert.equal(await b.locator('#input script').count(),0);
    console.log('PASS: rich-editor insertion preserves plain text and does not interpret HTML');

    // The immediate cancellation path must work while the send operation awaits an editor update.
    const countBeforeStop=await b.evaluate(()=>window.sent.length);
    const interrupted=chrome.tabs.sendMessage(2,{type:'send',profile,text:'Must remain unsent'});
    await new Promise(r=>setTimeout(r,150));await chrome.tabs.sendMessage(2,{type:'cancel'});
    assert.equal((await interrupted).ok,false);
    assert.equal(await b.evaluate(()=>window.sent.length),countBeforeStop);
    await b.locator('#input').fill('');
    console.log('PASS: Stop cancels an in-progress insertion before its send click');

    const oldUrl=b.url(), beforeGuardTests=await b.evaluate(()=>window.sent.length);
    const navigating=chrome.tabs.sendMessage(2,{type:'send',profile,text:'Do not send after navigation',expectedUrl:oldUrl});
    await new Promise(r=>setTimeout(r,150));
    await b.evaluate(()=>history.pushState({},'',location.href+'#another-chat'));
    const navigationResult=await navigating;assert.equal(navigationResult.ok,false);assert.match(navigationResult.error,/navigated/);
    assert.equal(await b.evaluate(()=>window.sent.length),beforeGuardTests);
    await b.evaluate(url=>history.replaceState({},'',url),oldUrl);await b.locator('#input').fill('');
    console.log('PASS: navigation during text insertion prevents the send click');

    const becomesBusy=chrome.tabs.sendMessage(2,{type:'send',profile,text:'Do not send into an active generation'});
    await new Promise(r=>setTimeout(r,150));await b.locator('#stop').evaluate(el=>el.hidden=false);
    const busyResult=await becomesBusy;assert.equal(busyResult.ok,false);assert.match(busyResult.error,/started generating/);
    assert.equal(await b.evaluate(()=>window.sent.length),beforeGuardTests);
    await b.locator('#stop').evaluate(el=>el.hidden=true);await b.locator('#input').fill('');
    console.log('PASS: a chat becoming busy during insertion prevents the send click');

    await b.evaluate(()=>{const extra=document.createElement('textarea');extra.id='extra';document.body.append(extra);});
    const ambiguous=await chrome.tabs.sendMessage(2,{type:'send',profile:{...profile,input:'#input, #extra'},text:'Ambiguous'});
    assert.equal(ambiguous.ok,false);assert.match(ambiguous.error,/exactly one editable/);
    await b.locator('#extra').evaluate(el=>el.remove());
    await b.locator('#input').evaluate(el=>el.setAttribute('contenteditable','false'));
    const readonly=await chrome.tabs.sendMessage(2,{type:'snapshot',profile});assert.equal(readonly.inputReady,false);
    await b.locator('#input').evaluate(el=>el.setAttribute('contenteditable','true'));
    console.log('PASS: ambiguous and non-editable message boxes cannot be used for sending');

    await command({type:'start',a:1,b:2,limit:5,existing:true});
    const activeId=getRun().id;
    await assert.rejects(command({type:'start',a:1,b:2,limit:5,existing:true}),/Stop the current relay/);
    assert.equal(getRun().id,activeId);assert.equal(getRun().status,'running');
    const beforeRestart=await b.evaluate(()=>window.sent.length);
    await startup();await command({type:'tick'});
    assert.equal(getRun().status,'paused');assert.equal(await b.evaluate(()=>window.sent.length),beforeRestart);
    console.log('PASS: simulated browser startup pauses the run before another send');
    await command({type:'stop'});
    console.log('PASS: duplicate Start cannot disrupt or replace the current run');

    const mediaProfile={...profile,upload:'#files',uploaded:'.upload-chip',uploadPending:'.upload-progress'};
    await command({type:'saveProfile',id:1,profile:mediaProfile});
    await b.evaluate(()=>{
      document.querySelector('main').insertAdjacentHTML('beforeend','<input id="files" type="file" multiple hidden><div id="uploads"></div>');
      window.receivedFiles=[];window.sentUploads=[];window.holdUpload=false;
      document.querySelector('#files').onchange=async e=>{
        const files=[...e.target.files];window.receivedFiles=[];
        document.querySelector('#uploads').innerHTML='<div class="upload-progress">Uploading…</div>';
        for(const f of files){window.receivedFiles.push({name:f.name,type:f.type,bytes:[...new Uint8Array(await f.arrayBuffer())]});}
        files.forEach(f=>{const chip=document.createElement('div');chip.className='upload-chip';chip.textContent=window.uploadNameOverride || f.name;document.querySelector('#uploads').append(chip);});
        if(!window.holdUpload)setTimeout(()=>document.querySelector('.upload-progress')?.remove(),300);
      };
      document.querySelector('#send').onclick=()=>{
        window.sent.push(document.querySelector('#input').innerText);window.sentUploads.push(window.receivedFiles);
        document.querySelector('#input').replaceChildren();document.querySelector('#files').value='';document.querySelector('#uploads').replaceChildren();
      };
    });
    await a.evaluate(()=>{
      const reply=document.createElement('div');reply.className='assistant';
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;canvas.getContext('2d').fillRect(0,0,128,128);
      window.expectedImage=canvas.toDataURL();
      const image=new Image();image.src=window.expectedImage;image.width=128;image.height=128;reply.append(image);
      const pdf=document.createElement('a');pdf.href='/assets/report.pdf';pdf.download='report.pdf';reply.append(pdf);
      const blob=document.createElement('a');blob.href=URL.createObjectURL(new Blob(['actual report bytes'],{type:'text/plain'}));blob.download='report.txt';reply.append(blob);
      document.querySelector('#messages').append(reply);
    });
    await a.waitForFunction(()=>document.querySelector('.assistant:last-child img').naturalWidth===128);
    const mediaSnapshot=await command({type:'test',id:1});
    assert.equal(mediaSnapshot.text,'');assert.equal(mediaSnapshot.attachments.length,3);
    assert(mediaSnapshot.attachments.some(a=>a.url.startsWith('inline:')));
    assert(!JSON.stringify(mediaSnapshot).includes('data:image/png;base64,'));
    await command({type:'start',a:1,b:2,limit:1,existing:true});await settle();
    assert.equal(getRun().status,'done',getRun().note);
    const uploads=await b.evaluate(()=>window.sentUploads.at(-1));assert.equal(uploads.length,3);
    const pdfUpload=uploads.find(f=>f.name==='report.pdf'),txtUpload=uploads.find(f=>f.name==='report.txt'),imageUpload=uploads.find(f=>f.type==='image/png');
    assert.equal(Buffer.from(pdfUpload.bytes).toString(),'%PDF-1.4\nfixture\n%%EOF');
    assert.equal(Buffer.from(txtUpload.bytes).toString(),'actual report bytes');
    assert.equal(Buffer.from(imageUpload.bytes).toString('base64'),(await a.evaluate(()=>window.expectedImage)).split(',')[1]);
    assert(!JSON.stringify(data).includes('base64,'));
    console.log('PASS: image-only reply with inline PNG, PDF and blob file uploads actual bytes; no attachment bytes stored');

    const imageItem=mediaSnapshot.attachments.find(a=>a.kind==='image');
    const payload=(await chrome.tabs.sendMessage(1,{type:'readAttachment',profile:mediaProfile,expectedUrl:a.url(),item:imageItem})).file;
    await b.evaluate(()=>window.holdUpload=true);
    const sendsBeforeUploadStop=await b.evaluate(()=>window.sent.length);
    const waitingUpload=chrome.tabs.sendMessage(2,{type:'send',profile:mediaProfile,text:'Wait for files',attachments:[payload]});
    await new Promise(r=>setTimeout(r,600));assert.equal(await b.evaluate(()=>window.sent.length),sendsBeforeUploadStop);
    await chrome.tabs.sendMessage(2,{type:'cancel'});assert.equal((await waitingUpload).ok,false);
    assert.equal(await b.evaluate(()=>window.sent.length),sendsBeforeUploadStop);
    await b.evaluate(()=>{document.querySelector('#files').value='';document.querySelector('#uploads').replaceChildren();window.holdUpload=false;});
    console.log('PASS: upload-in-progress prevents sending, and Stop cancels the upload wait');

    const clearUpload=()=>b.evaluate(()=>{document.querySelector('#input').replaceChildren();document.querySelector('#files').value='';document.querySelector('#uploads').replaceChildren();window.holdUpload=false;window.uploadNameOverride='';});
    await b.evaluate(()=>window.holdUpload=true);
    const humanDraft=chrome.tabs.sendMessage(2,{type:'send',profile:mediaProfile,text:'Relay text must not replace a human draft',attachments:[payload]});
    await b.waitForSelector('.upload-chip');await b.locator('#input').fill('Keep my human draft');
    await b.locator('.upload-progress').evaluate(el=>el.remove());
    const humanResult=await humanDraft;assert.equal(humanResult.ok,false);assert.match(humanResult.error,/draft appeared/);
    assert.equal(await b.locator('#input').innerText(),'Keep my human draft');assert.equal(await b.evaluate(()=>window.sent.length),sendsBeforeUploadStop);
    await clearUpload();
    console.log('PASS: text typed during an upload wait is preserved instead of overwritten');

    const vanishing=chrome.tabs.sendMessage(2,{type:'send',profile:mediaProfile,text:'Check files again before send',attachments:[payload]});
    await b.waitForFunction(()=>document.querySelector('#input').innerText==='Check files again before send');
    await b.evaluate(()=>{document.querySelector('#uploads').replaceChildren();document.querySelector('#files').value='';});
    const vanishedResult=await vanishing;assert.equal(vanishedResult.ok,false);assert.match(vanishedResult.error,/Attachments changed/);
    assert.equal(await b.evaluate(()=>window.sent.length),sendsBeforeUploadStop);await clearUpload();
    console.log('PASS: attachment removal after initial upload readiness prevents Send');

    await b.evaluate(()=>window.uploadNameOverride='wrong-file.txt');
    const wrongFilename=chrome.tabs.sendMessage(2,{type:'send',profile:mediaProfile,text:'Must not send wrong filenames',attachments:[payload]});
    await new Promise(r=>setTimeout(r,3200));assert.equal(await b.evaluate(()=>window.sent.length),sendsBeforeUploadStop);
    await chrome.tabs.sendMessage(2,{type:'cancel'});assert.equal((await wrongFilename).ok,false);await clearUpload();
    console.log('PASS: the right preview count with a wrong filename never becomes ready');

    await a.evaluate(()=>{document.querySelector('.assistant:last-child').innerHTML='<a href="sandbox:/mnt/data/private.pdf" download="private.pdf">Report</a>';});
    const unsupported=await command({type:'test',id:1});assert.match(unsupported.attachments[0].error,/site-specific/);
    console.log('PASS: private internal file links are reported instead of silently omitted');

    await a.locator('#stop').evaluate(el=>el.hidden=false);await b.locator('#stop').evaluate(el=>el.hidden=false);
    const stopCounts=await Promise.all([a.evaluate(()=>window.stopClicks),b.evaluate(()=>window.stopClicks)]);
    await command({type:'stop',a:1,b:2});
    assert.equal(await a.evaluate(()=>window.stopClicks),stopCounts[0]+1);
    assert.equal(await b.evaluate(()=>window.stopClicks),stopCounts[1]+1);
    console.log('PASS: Stop Both Chats clicks both detected generation-stop controls');

    const semantic=await context.newPage();await semantic.goto(base+'/semantic-chat');
    await semantic.setContent('<textarea placeholder="Search videos"></textarea><section><div data-message-role="user">User words</div><div data-message-role="assistant">Assistant answer only</div></section><form><textarea placeholder="Ask Muse a question"></textarea><button type="submit" aria-label="Send message">↑</button><button type="button" aria-label="Stop generating">■</button></form>');
    await semantic.addScriptTag({content:fs.readFileSync(path.join(root,'detect.js'),'utf8')});
    const detected=await semantic.evaluate(()=>{const p=__tabRelayDetect.resolve();return {input:document.querySelector(p.input)?.getAttribute('placeholder'),reply:document.querySelector(p.reply)?.textContent,stop:document.querySelectorAll(p.busy).length};});
    assert.equal(detected.input,'Ask Muse a question');assert.equal(detected.reply,'Assistant answer only');assert.equal(detected.stop,1);
    await semantic.evaluate(()=>{document.querySelector('form').append(document.querySelector('form textarea').cloneNode());});
    assert.equal(await semantic.evaluate(()=>document.querySelectorAll(__tabRelayDetect.resolve().input).length),0);
    await semantic.close();
    console.log('PASS: semantic auto-detection ignores search/user messages and refuses ambiguous composers');

    await a.locator('#messages').evaluate(el=>el.replaceChildren());
    delete data.profiles;
    await command({type:'start',a:1,b:2,existing:true,limit:1,automatic:true});
    assert.equal(getRun().next,1);await command({type:'stop'});
    console.log('PASS: with no saved configuration, Start automatically chooses Chat B when only B has a latest reply');

    const popup=await context.newPage();
    await popup.exposeFunction('relayTestApi',async(method,value)=>{
      if(method==='message'){try{return {ok:true,result:await command(value)};}catch(e){return {ok:false,error:e.message};}}
      if(method==='get')return get(value);
      if(method==='set')return set(value);
      if(method==='tabs')return [...pages.keys()].map(tabInfo);
      if(method==='remove'){delete data[value];return;}
    });
    await popup.addInitScript(()=>{globalThis.chrome={runtime:{sendMessage:m=>relayTestApi('message',m)},storage:{local:{get:k=>relayTestApi('get',k),set:v=>relayTestApi('set',v),remove:k=>relayTestApi('remove',k)},onChanged:{addListener:()=>{}}},tabs:{query:()=>relayTestApi('tabs')},permissions:{request:async()=>true,contains:async()=>true}};});
    await popup.goto(base+'/extension/popup.html');
    await popup.waitForFunction(()=>document.querySelector('#a').options.length===3);
    await popup.selectOption('#a','1');await popup.selectOption('#b','2');
    assert.equal(await popup.locator('select').count(),2);
    assert.equal(await popup.locator('#configA,#configB,#fields,#seed,#limit').count(),0);
    await popup.click('#start');
    for(let i=0;i<60 && getRun().status!=='running';i++){await new Promise(r=>setTimeout(r,100));const message=await popup.locator('#error').innerText();if(message)throw Error('Popup Start: '+message);}
    assert.equal(getRun().status,'running','Popup Start failed: '+await popup.locator('#error').innerText());
    await popup.click('#stop');
    await popup.waitForFunction(()=>document.querySelector('#statusTitle').textContent==='Stopped');
    assert.equal(getRun().status,'stopped');
    await popup.screenshot({path:path.join(__dirname,'../preview.png'),fullPage:true});
    assert.equal(errors.length,0,'Browser errors: '+errors.join('; '));
    console.log('PASS: simple popup has two tab selectors, no configuration fields, and working Start/Stop');
    console.log('NOTE: Chrome extension APIs shimmed; unpacked extension loading is blocked by this environment browser policy.');
  } finally {
    Date.now=realNow;if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
