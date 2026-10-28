import {observe, newReply, validateRun, normalize, contentKey, hasContent} from './logic.js';
import {downloadExternal, MAX_FILE, MAX_TOTAL, MAX_FILES, permissionPattern} from './attachments.js';

const CHATGPT = {input:'#prompt-textarea', reply:'[data-message-author-role="assistant"]',
  send:'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]',
  busy:'button[data-testid="stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"]'};
let inTick = false;
let commandQueue = Promise.resolve();
let stopRequested = false;
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
  const profiles = await read('profiles') || {};
  const defaults={input:'',reply:'',send:'',busy:'',attachment:'',upload:'input[type="file"]',uploaded:'',uploadPending:''};
  return {tab, origin, profile:{...defaults,...(/^https:\/\/(chatgpt\.com|chat\.openai\.com)$/.test(origin)?CHATGPT:{}),...(profiles[origin] || {})}};
}
async function page(id, message) {
  await chrome.scripting.executeScript({target:{tabId:id}, files:['media.js','page.js']});
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
  if (!profile.input || !profile.reply || !profile.send) throw new Error('Configure the message box, assistant replies, and send button for both tabs.');
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
    } else file=await downloadExternal(item,side.url,chrome.permissions);
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
  if (snapshots.some(s => s.busy || !s.inputReady)) throw new Error('Both chats must be idle with an enabled message box.');
  if (snapshots.some(s => s.inputText.trim() || s.draftAttachments)) throw new Error('Clear or send existing drafts and attachments in both tabs before starting.');
  if (stopRequested) throw new Error('Stopped before starting.');
  const run = {id:crypto.randomUUID(), status:'running', sides, limit, sent:0, next:0,
    started:Date.now(), waitingSince:Date.now(), phase:'waiting', baseline:snapshots[0], seen:[], log:[], existing:!!message.existing};
  if (message.existing) {
    if (!hasContent(snapshots[0])) throw new Error('Tab A has no visible assistant reply.');
    log(run, 'Waiting for the latest reply in tab A to settle.');
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
    if (!run.existing && !newReply(run.baseline, current)) {
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
    if(current.attachments?.length && (!run.sides[target].profile.uploaded || !run.sides[target].profile.uploadPending)) throw new Error('Configure uploaded-file previews and upload-progress selectors on the receiving site before transferring images/files.');
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
    run.existing = false; run.observation = null; run.phase = 'waiting'; run.waitingSince = Date.now();
    log(run, `Message ${run.sent}/${run.limit} accepted. Waiting for tab ${target ? 'B' : 'A'}.`);
    if (stopRequested) await pause(run, 'Stopped. A message already in progress may have been sent.', 'stopped');
    else if (run.sent >= run.limit) await pause(run, 'Message limit reached.', 'done');
    else await save(run);
  } catch (error) {
    if (run) await pause(run, error.message);
  } finally {inTick = false;}
}

async function command(message, sender) {
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
    try {return await start(message);} catch(error) {
      const run = await read('run');
      if (run?.status === 'running' && run.id !== previous?.id) await pause(run, error.message);
      throw error;
    }
  }
  if (message.type === 'stop') {
    const run = await read('run');
    if (run) await pause(run, 'Stopped by you. Existing generations continue in their tabs.', 'stopped');
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
    read('run').then(run => run?.sides.forEach(side => chrome.tabs.sendMessage(side.id, {type:'cancel'}).catch(() => {})));
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
