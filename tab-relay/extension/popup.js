const $=id=>document.getElementById(id);
let tabs=[],run=null,starting=false,checkVersion=0;
const pattern=url=>{const u=new URL(url);return `${u.protocol}//${u.hostname}/*`;};
async function request(message){const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw Error(response?.error || 'The extension did not respond.');return response.result;}
const selected=()=>[Number($('a').value),Number($('b').value)];
function sites(){return [...new Set(selected().map(id=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw Error('Choose two available chat tabs.');return pattern(tab.url);} ))];}
const error=e=>{$('error').textContent=e?.message || '';};
async function saveSelection(){const [a,b]=selected();await chrome.storage.local.set({selection:{a,b}});}
async function loadTabs(){
  tabs=(await chrome.tabs.query({})).filter(t=>/^https?:\/\//.test(t.url || ''));
  const saved=(await chrome.storage.local.get('selection')).selection || {};
  const muse=tabs.find(t=>/(^|\.)muse\.ai$/.test(new URL(t.url).hostname));
  const chatgpt=tabs.find(t=>/^(chatgpt\.com|chat\.openai\.com)$/.test(new URL(t.url).hostname));
  for(const side of ['a','b']){
    const previous=Number($(side).value) || saved[side] || (side==='a'?muse?.id:chatgpt?.id);
    $(side).replaceChildren(new Option('Choose a chat tab…',''));
    for(const tab of tabs)$(side).append(new Option(`${tab.title || 'Chat'} — ${new URL(tab.url).hostname}`,String(tab.id)));
    if(tabs.some(t=>t.id===previous))$(side).value=previous;
  }
}
async function inspect(){
  const version=++checkVersion;
  const [a,b]=selected();if(!a || !b || a===b){$('detection').textContent='Choose two different chat tabs';return;}
  if(!await chrome.permissions.contains({origins:sites()})){$('detection').textContent='Press Start to connect your chats';return;}
  try{
    const info=await request({type:'inspectPair',a,b});
    if(version!==checkVersion || run?.status==='running')return;
    const ready=info.every(t=>t.ready) && info.some(t=>t.hasReply || t.busy);
    $('detection').textContent=ready?'Latest replies detected':'Open a conversation in each tab';
    $('dot').className='dot '+(ready?'ready':'');
    $('statusTitle').textContent=ready?'Ready to start':'Waiting for your chats';
    $('status').textContent=ready?`Starts with ${info[0].hasReply || info[0].busy?'Chat A':'Chat B'}’s latest reply.`:'Send a message in either chat, then press Start.';
  }catch(e){if(version===checkVersion){$('detection').textContent='Automatic detection will run at Start';}}
}
async function render(){
  run=(await chrome.storage.local.get('run')).run;
  const active=run?.status==='running';
  $('start').disabled=active || starting;
  for(const id of ['a','b','swap'])$(id).disabled=active || starting;
  $('stop').disabled=!selected().every(Boolean) && !run;
  if(run){
    $('dot').className='dot '+run.status;
    $('statusTitle').textContent=active?'Sharing automatically':run.status==='paused'?'Sharing paused':run.status==='stopped'?'Stopped':'Session complete';
    $('status').textContent=run.note || `${run.sent} messages shared · waiting for Chat ${run.next?'B':'A'}.`;
    if(active)$('detection').textContent='Following the latest replies';
    else if(run.status==='stopped')$('detection').textContent='Automatic sharing is stopped';
    else if(run.status==='paused')$('detection').textContent='Paused — see the status below';
  }
}
for(const side of ['a','b'])$(side).onchange=async()=>{error(null);await saveSelection();await render();await inspect();};
$('swap').onclick=async()=>{const a=$('a').value;$('a').value=$('b').value;$('b').value=a;await saveSelection();await inspect();};
$('start').onclick=async()=>{
  error(null);starting=true;
  try{
    const [a,b]=selected();if(!a || !b || a===b)throw Error('Choose two different chat tabs.');
    const resume=run?.status==='paused' && run.needsOrigins?.length && run.sides[0].id===a && run.sides[1].id===b;
    // Permission request stays on the user gesture; no settings screens are needed.
    if(!await chrome.permissions.request({origins:[...new Set([...sites(),...(resume?run.needsOrigins:[])])]}))throw Error('Chrome needs access to the selected chat sites to share messages.');
    await saveSelection();await render();
    await request({type:'start',a,b,existing:true,limit:100,automatic:true,resumeId:resume?run.id:undefined});
  }catch(e){error(e);}finally{starting=false;await render();}
};
$('stop').onclick=async()=>{error(null);try{const [a,b]=selected();await request({type:'stop',a,b});}catch(e){error(e);}await render();};
chrome.storage.onChanged.addListener(()=>render().catch(error));
await loadTabs();await render();await inspect();
setInterval(()=>request({type:'tick'}).catch(error),2000);
