import {observe, newReply, validateRun, normalize, contentKey, hasContent} from './logic.js';
import {downloadExternal, MAX_FILE, MAX_TOTAL, MAX_FILES, permissionPattern} from './attachments.js';

const CHATGPT = {input:'#prompt-textarea', reply:'[data-message-author-role="assistant"]',
  send:'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',
  busy:'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]'};
let inTick = false;
let commandQueue = Promise.resolve();
let stopRequested = false;
let immediateStop=Promise.resolve([]);
const read = async key => (await chrome.storage.local.get(key))[key];
const save = run => chrome.storage.local.set({run});
const log = (run, message) => {run.log = [...(run.log || []), {at:Date.now(), message}].slice(-40);};

async function tabInfo(id) {
  const tab = await chrome.tabs.get(id);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Select a regular http/https chat page.');
  return tab;
}
async function profileFor(id) {
  const tab = await tabInfo(id);
  const origin = new URL(tab.url).origin;
  if(!await chrome.permissions.contains({origins:[permissionPattern(tab.url)]}))throw new Error(`Chrome site access is missing for ${origin}. Open Tab Relay, select both chat tabs, click Start Sharing, and approve access to both sites. Reload the tabs if Chrome asks.`);
  const result=await page(id,{type:'detect'});
  return {tab,origin,profile:result.profile};
}
async function page(id, message) {
  try {await chrome.scripting.executeScript({target:{tabId:id}, files:['detect.js','media.js','page.js']});}
  catch(error){
    if(/cannot access|permission|host access|not allowed/i.test(error.message || '')){
      const tab=await tabInfo(id);
      throw new Error(`Chrome blocked Tab Relay on ${new URL(tab.url).origin}. Check that this site is listed in Tab Relay’s Chrome site-access settings, reload both chat tabs, then Start Sharing.`);
    }
    throw error;
  }
  if (message.type === 'send' && stopRequested) throw new Error('Stopped before sending.');
  const result = await chrome.tabs.sendMessage(id, message);
  if (!result?.ok) throw new Error(result?.error || 'The page did not respond.');
  return result;
}
async function snap(side) {
  const tab = await tabInfo(side.id);
  if (tab.url !== side.url) throw new Error('A selected tab navigated. Stop and start again on the intended conversations.');
  const result = await page(side.id, {type:'snapshot', profile:side.profile});
  if (result.url !== side.url) throw new Error('A selected tab navigated while it was being read. Start again on the intended conversations.');
  return result;
}
function checkProfile(profile) {
  if (!profile.input || !profile.reply || !profile.send) throw new Error('Automatic detection could not identify this chat. Open its conversation and try again.');
}
async function filesFor(side, snapshot) {
  const items=snapshot.attachments || [];
  if(items.length>MAX_FILES)throw new Error('Reply has more than 5 attachments. Nothing was sent.');
  const files=[];let total=0;
  for(const item of items){
    if(stopRequested)throw new Error('Stopped before transferring attachments.');
    if(item.error || item.pending)throw new Error(item.error || 'An attachment is not ready.');
    const url=new URL(item.url);
    let file;
    if(['data:','blob:','inline:'].includes(url.protocol) || url.origin===new URL(side.url).origin){
      file=(await page(side.id,{type:'readAttachment',profile:side.profile,expectedUrl:side.url,item})).file;
    } else {
      const pattern=permissionPattern(url.href);
      if(!await chrome.permissions.contains({origins:[pattern]})){
        const error=new Error('Additional file-host access is needed. Click Start Sharing again to approve it.');error.needsOrigins=[pattern];throw error;
      }
      file=await downloadExternal(item,side.url,chrome.permissions);
    }
    total+=file.size;
    if(file.size>MAX_FILE || total>MAX_TOTAL)throw new Error('Attachment limit: 10 MB each, 20 MB total. Nothing was sent.');
    files.push(file);
  }
  return files;
}

async function pause(run, message, status = 'paused') {
  run.status = status; run.note = message;
  log(run, message); await save(run);
  await chrome.action.setBadgeText({text:status === 'done' ? '✓' : '!'});
  await chrome.action.setBadgeBackgroundColor({color:status === 'done' ? '#087f73' : '#b45309'});
}

async function start(message) {
  const a = Number(message.a), b = Number(message.b), limit = Number(message.limit);
  validateRun(a, b, limit, message.seed, message.existing);
  const old = await read('run');
  if (old?.status === 'running') throw new Error('Stop the current relay first.');
  stopRequested = false;
  const sides = [];
  for (const id of [a,b]) {
    const {tab, profile} = await profileFor(id); checkProfile(profile);
    sides.push({id, url:tab.url, title:tab.title, profile});
  }
  const snapshots = await Promise.all(sides.map(snap));
  if (snapshots.some(s => message.automatic ? s.inputCount!==1 : (s.busy || !s.inputReady))) throw new Error('Both chats must be idle with an enabled message box.');
  if (snapshots.some(s => s.inputText.trim() || s.draftAttachments)) throw new Error('Clear or send existing drafts and attachments in both tabs before starting.');
  if (stopRequested) throw new Error('Stopped before starting.');
  const source=message.automatic && !hasContent(snapshots[0]) && !snapshots[0].busy && (hasContent(snapshots[1]) || snapshots[1].busy)?1:0;
  const run = {id:crypto.randomUUID(), status:'running', sides, limit, sent:0, next:source,
    started:Date.now(), waitingSince:Date.now(), phase:'waiting', baseline:snapshots[source], seen:[], log:[], existing:!!message.existing};
  if (message.existing) {
    if (!hasContent(snapshots[source]) && !snapshots[source].busy) throw new Error('Tab A has no visible assistant reply.');
    log(run,`Waiting for the latest reply in Chat ${source?'B':'A'} to settle.`);
    await save(run);
  } else {
    run.phase = 'sending'; log(run, 'Sending the opening message to tab A.'); await save(run);
    await page(a, {type:'send', profile:sides[0].profile, text:normalize(message.seed), expectedUrl:sides[0].url});
    run.phase = 'waiting'; run.sent = 1; log(run, 'Opening message accepted. Waiting for tab A.');
    if (stopRequested) await pause(run, 'Stopped. A message already in progress may have been sent.', 'stopped');
    else if (run.sent >= limit) await pause(run, 'Message limit reached.', 'done');
    else await save(run);
  }
  if (run.status === 'running') {
    await chrome.action.setBadgeText({text:'ON'});
    await chrome.action.setBadgeBackgroundColor({color:'#087f73'});
  }
  await chrome.alarms.create('relay', {periodInMinutes:0.5});
  return run;
}

async function tick() {
  if (inTick) return;
  inTick = true;
  let run;
  try {
    run = await read('run');
    if (run?.status !== 'running' || stopRequested) return;
    if (run.phase === 'sending') {await pause(run, 'Delivery was interrupted or uncertain. Check both chats before starting again.'); return;}
    if (Date.now() - run.waitingSince > 10 * 60 * 1000) {await pause(run, 'No completed new reply within 10 minutes. Check the selected tabs.'); return;}
    const current = await snap(run.sides[run.next]);
    const sourceName=`Chat ${run.next?'B':'A'}`;
    run.diagnostics={side:run.next,replyCount:current.count,inputCount:current.inputCount,inputReady:current.inputReady,busy:current.busy,replyDetection:current.diagnostics?.replyDetection || 'explicit'};
    if(current.busy){run.waitReason='generating';run.note=`${sourceName} is still generating. Waiting for it to finish.`;run.missingReplySince=null;}
    else if(!current.count){
      run.waitReason='reply-not-detected';
      run.note=`${sourceName}: no assistant reply is detected on this page yet.`;
      run.missingReplySince ??= Date.now();
      if(Date.now()-run.missingReplySince>=30000){await pause(run,`${sourceName}’s assistant reply could not be detected. This page layout needs a reader update; nothing was sent.`);return;}
    } else {run.waitReason='settling';run.missingReplySince=null;run.note=!current.inputReady?`${sourceName}’s message box is not ready. Waiting.`:current.assetsReady===false?`${sourceName}’s images are still loading.`:`${sourceName} reply detected. Waiting for the text to settle.`;}
    if (!run.existing && !newReply(run.baseline, current)) {
      if(current.count && !current.busy)run.note=`Waiting for a new assistant reply from ${sourceName}.`;
      run.observation = null; await save(run); return;
    }
    run.observation = observe(run.observation, current, Date.now());
    if (!run.observation.ready) {await save(run); return;}
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${run.next}:${contentKey(current)}`));
    const key = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('');
    if (run.seen.includes(key)) {await pause(run, 'Repeated reply detected. Relay paused to prevent a loop.'); return;}
    const target = 1 - run.next;
    const baseline = await snap(run.sides[target]);
    if (baseline.busy || !baseline.inputReady || baseline.inputText.trim() || baseline.draftAttachments) {
      await pause(run, 'The receiving tab is busy or contains a draft. Nothing was overwritten.'); return;
    }
    if(current.attachments?.length && (!run.sides[target].profile.uploaded || !run.sides[target].profile.uploadPending)) throw new Error('The receiving site’s upload controls could not be detected automatically.');
    const attachments=await filesFor(run.sides[run.next],current);
    const confirmedSource = await snap(run.sides[run.next]);
    if (confirmedSource.busy || !confirmedSource.inputReady || contentKey(confirmedSource) !== contentKey(current) || confirmedSource.count !== current.count) {
      run.observation = null; await save(run); return;
    }
    const latest = await read('run');
    if (stopRequested || latest?.status !== 'running' || latest.id !== run.id) return;
    run.phase = 'sending'; log(run, `Sending reply from tab ${run.next ? 'B' : 'A'} to tab ${target ? 'B' : 'A'}.`);
    await save(run); // Persist before clicking: never retry ambiguous sends after a worker restart.
    if (stopRequested) {await pause(run, 'Stopped.', 'stopped'); return;}
    await page(run.sides[target].id, {type:'send', profile:run.sides[target].profile, text:current.text, attachments, expectedUrl:run.sides[target].url});
    run.seen.push(key); run.sent++; run.next = target; run.baseline = baseline;
    run.existing = false; run.observation = null; run.phase = 'waiting'; run.waitingSince = Date.now();run.note='';run.waitReason='';run.missingReplySince=null;
    log(run, `Message ${run.sent}/${run.limit} accepted. Waiting for tab ${target ? 'B' : 'A'}.`);
    if (stopRequested) await pause(run, 'Stopped. A message already in progress may have been sent.', 'stopped');
    else if (run.sent >= run.limit) await pause(run, 'Message limit reached.', 'done');
    else await save(run);
  } catch (error) {
    if (run) {if(error.needsOrigins)run.needsOrigins=error.needsOrigins;await pause(run, error.message);}
  } finally {inTick = false;}
}

async function command(message, sender) {
  if(message.type==='inspectPair'){
    const results=[];
    for(const id of [Number(message.a),Number(message.b)]){const {tab,profile}=await profileFor(id);const snapshot=await snap({id,url:tab.url,profile});results.push({id,kind:profile.kind,ready:snapshot.inputReady,hasReply:hasContent(snapshot),busy:snapshot.busy,attachments:snapshot.attachments.length});}
    return results;
  }
  if(message.type==='inspectMedia') {
    const results=[];const origins=new Set();
    for(const id of [Number(message.a),Number(message.b)]){
      const {tab,profile}=await profileFor(id);checkProfile(profile);
      const snapshot=await snap({id,url:tab.url,profile});
      for(const item of snapshot.attachments){try{const u=new URL(item.url);if(['http:','https:'].includes(u.protocol) && u.origin!==new URL(tab.url).origin)origins.add(permissionPattern(u.href));}catch{}}
      results.push({id,files:snapshot.attachments.map(({name,kind,error})=>({name,kind,error}))});
    }
    return {results,origins:[...origins]};
  }
  if (message.type === 'getProfile') return profileFor(Number(message.id));
  if (message.type === 'saveProfile' || message.type === 'picked') {
    if ((await read('run'))?.status === 'running') throw new Error('Stop the relay before changing page controls.');
    const {origin, profile} = await profileFor(message.type === 'picked' ? sender.tab.id : Number(message.id));
    const profiles = await read('profiles') || {};
    profiles[origin] = message.type === 'picked' ? {...profile, [message.role]:message.selector} : message.profile;
    await chrome.storage.local.set({profiles}); return {};
  }
  if (message.type === 'pick') {
    if ((await read('run'))?.status === 'running') throw new Error('Stop the relay before configuring tabs.');
    await chrome.tabs.update(Number(message.id), {active:true});
    return page(Number(message.id), {type:'pick', role:message.role});
  }
  if (message.type === 'test') {
    const {tab, profile} = await profileFor(Number(message.id)); checkProfile(profile);
    return snap({id:tab.id, url:tab.url, profile});
  }
  if (message.type === 'start') {
    const previous = await read('run');
    try {
      if(message.resumeId && previous?.id===message.resumeId && previous.status==='paused' && previous.needsOrigins?.length){
        if(previous.sides[0].id!==Number(message.a) || previous.sides[1].id!==Number(message.b))throw new Error('Selected tabs changed. Start a fresh conversation.');
        for(const side of previous.sides){const current=await snap(side);if(current.busy || !current.inputReady || current.inputText.trim() || current.draftAttachments)throw new Error('Clear drafts and wait for the selected chats before continuing.');}
        stopRequested=false;previous.status='running';previous.note='';previous.needsOrigins=[];previous.observation=null;previous.waitingSince=Date.now();
        await save(previous);await chrome.alarms.create('relay',{periodInMinutes:0.5});return previous;
      }
      return await start(message);
    } catch(error) {
      const run = await read('run');
      if (run?.status === 'running' && run.id !== previous?.id) await pause(run, error.message);
      throw error;
    }
  }
  if (message.type === 'stop') {
    let run = await read('run');
    if(run?.status!=='running' && message.a && message.b){const sides=[];for(const id of [Number(message.a),Number(message.b)]){const {tab,profile}=await profileFor(id);sides.push({id,url:tab.url,profile});}run={id:crypto.randomUUID(),sides,sent:0,limit:100,next:0,log:[]};}
    if (run) {
      const early=await immediateStop;
      const results=await Promise.allSettled(run.sides.map(async side=>{const tab=await tabInfo(side.id);if(tab.url!==side.url)throw new Error('Tab navigated');return page(side.id,{type:'halt',profile:side.profile});}));
      const attempted=[...early,...results].reduce((n,r)=>n+(r.status==='fulfilled'?(Number(r.value?.attempted)||0):0),0);
      const detail=results.some(r=>r.status==='rejected')?' One or more tabs could not be reached.':'';
      await pause(run,`Sharing stopped. ${attempted?'Stop controls clicked in the selected chats.':'No active stop controls were detected.'}${detail}`,'stopped');
    }
    await chrome.alarms.clear('relay'); return {};
  }
  if (message.type === 'tick') {await tick(); return {};}
  throw new Error('Unknown command.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if(message.type==='heartbeat'){respond({ok:true});return;}
  // A popup Stop immediately cancels page-side sends that have not clicked yet.
  if (message.type === 'stop') {
    stopRequested = true;
    immediateStop=read('run').then(run=>Promise.allSettled(((run?.status==='running' || !message.a || !message.b)?(run?.sides || []):[]).map(async side=>{const tab=await tabInfo(side.id);if(tab.url!==side.url)throw Error('Tab navigated');return chrome.tabs.sendMessage(side.id,{type:'halt',profile:side.profile});}))); 
  }
  const job = commandQueue.then(() => command(message, sender));
  commandQueue = job.catch(() => {});
  job.then(result => respond({ok:true, result}), error => respond({ok:false, error:error.message}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'relay') {commandQueue = commandQueue.then(tick).catch(() => {});}
});
chrome.runtime.onStartup.addListener(() => {
  stopRequested = true;
  commandQueue = commandQueue.then(async()=>{
    const run = await read('run');
    if (run?.status === 'running') await pause(run, 'Browser restarted. Start a new relay after checking the selected conversations.');
    await chrome.alarms.clear('relay');
  }).catch(()=>{});
  return commandQueue;
});
