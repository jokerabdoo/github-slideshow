import {test} from 'node:test';
import assert from 'node:assert/strict';
import {downloadExternal, permissionPattern, MAX_FILE} from '../extension/attachments.js';
import {observe,newReply,contentKey} from '../extension/logic.js';

test('image/file-only replies participate in completion and change detection',()=>{
  const snapshot={text:'',attachments:[{url:'blob:one',name:'image.png',kind:'image',pending:false}],inputReady:true};
  const first=observe(null,snapshot,0);
  assert.equal(observe(first,snapshot,8000).ready,true);
  assert.equal(observe(first,{...snapshot,assetsReady:false},8000).ready,false);
  assert.equal(newReply({text:'',count:1},{...snapshot,count:1}),true);
  assert.notEqual(contentKey(snapshot),contentKey({...snapshot,attachments:[{...snapshot.attachments[0],url:'blob:two'}]}));
});
test('cross-site files require permission and never send cookies or follow redirects',async()=>{
  let called=false;
  const item={url:'https://files.example.com/report.pdf?signature=secret',name:'report.pdf',kind:'file'};
  await assert.rejects(downloadExternal(item,'https://chat.example.com/',{contains:async()=>false},()=>{called=true;}),/Allow attachment access/);
  assert.equal(called,false);
  const file=await downloadExternal(item,'https://chat.example.com/',{contains:async request=>{assert.deepEqual(request.origins,['https://files.example.com/*']);return true;}},async(url,options)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response('%PDF-test',{headers:{'content-type':'application/pdf'}});
  });
  assert.equal(atob(file.base64),'%PDF-test');assert.equal(file.mime,'application/pdf');
  assert.equal(permissionPattern('http://localhost:1234/x'),'http://localhost/*');
});
test('oversized and login-page responses fail instead of being forwarded',async()=>{
  const item={url:'https://files.example.com/file.pdf',name:'file.pdf',kind:'file'},permissions={contains:async()=>true};
  await assert.rejects(downloadExternal(item,'https://chat.example.com',permissions,async()=>new Response('x',{headers:{'content-length':String(MAX_FILE+1)}})),/10 MB/);
  await assert.rejects(downloadExternal(item,'https://chat.example.com',permissions,async()=>new Response('<html>Sign in</html>',{headers:{'content-type':'text/html'}})),/login page/);
});
