const $ = id => document.getElementById(id);
let tabs = [], editing = null, fileOrigins = [];
const roles = {input:'Message box', reply:'Assistant replies', send:'Send button', busy:'Stop button (optional, recommended)',attachment:'Reply images / download links (optional)',upload:'File-upload input CSS (may be hidden)',uploaded:'Completed upload previews (required for files)',uploadPending:'Upload-progress indicator (required for files)'};
const showError = error => {$('error').textContent = error?.message || String(error || '');};
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'The extension did not respond.');
  return response.result;
}
async function guarded(fn) {showError(''); try {return await fn();} catch(e) {showError(e);}}
function originPattern(id) {
  const tab = tabs.find(t => t.id === Number(id));
  if (!tab) throw new Error('Refresh and select an available tab.');
  const u=new URL(tab.url);return u.protocol+'//'+u.hostname+'/*';
}
function permission(ids) {return chrome.permissions.request({origins:[...new Set(ids.map(originPattern))]});}
async function loadTabs() {
  tabs = (await chrome.tabs.query({})).filter(t => /^https?:\/\//.test(t.url || ''));
  const saved = (await chrome.storage.local.get('selection')).selection || {};
  for (const side of ['a','b']) {
    const previous = Number($(side).value) || saved[side];
    $(side).replaceChildren();
    const empty = new Option('Choose a chat tab…', ''); $(side).append(empty);
    for (const tab of tabs) $(side).append(new Option(`${tab.title || new URL(tab.url).hostname} — ${new URL(tab.url).hostname}`, String(tab.id)));
    if (tabs.some(t => t.id === previous)) $(side).value = previous;
  }
}
async function saveSelection() {
  await chrome.storage.local.set({selection:{a:Number($('a').value), b:Number($('b').value)}});
}
function profileFields() {return Object.fromEntries(Object.keys(roles).map(role => [role,$('field-'+role).value.trim()]));}
async function saveProfile() {await request({type:'saveProfile', id:editing, profile:profileFields()});}
async function configure(side) {
  if (!await permission([$(side).value])) throw new Error('Site access was not granted.');
  editing = Number($(side).value);
  const {profile, origin} = await request({type:'getProfile', id:editing});
  $('configTitle').textContent = `Controls for tab ${side.toUpperCase()} · ${origin}`;
  $('config').hidden = false; $('fields').replaceChildren(); $('sample').textContent = '';
  for (const [role,label] of Object.entries(roles)) {
    const row = document.createElement('div'); row.className = 'field';
    const lab = document.createElement('label'); lab.textContent = label;
    const input = document.createElement('input'); input.id = 'field-'+role; input.className = 'selector'; input.value = profile[role] || ''; input.placeholder = 'CSS selector'; lab.append(input);
    const button = document.createElement('button'); button.textContent = 'Pick on page';
    if(role==='upload'){button.disabled=true;button.textContent='Enter CSS';}
    button.addEventListener('click', () => guarded(async () => {
      await saveProfile();
      await chrome.storage.local.set({pendingPicker:{id:editing, role}});
      await request({type:'pick', id:editing, role}); window.close();
    }));
    row.append(lab,button); $('fields').append(row);
  }
}
async function render() {
  const {run} = await chrome.storage.local.get('run');
  const running = run?.status === 'running';
  $('badge').textContent = run?.status || 'Idle';
  $('start').disabled = running; $('stop').disabled = !running;
  for (const id of ['a','b','configA','configB','seed','existing','limit','saveProfile','test']) $(id).disabled = running;
  $('status').textContent = run ? (run.note || `${run.sent}/${run.limit} messages sent · waiting for tab ${run.next ? 'B' : 'A'}`) : 'Choose two tabs to begin.';
  $('log').replaceChildren();
  for (const entry of [...(run?.log || [])].reverse()) {
    const li = document.createElement('li'), time = document.createElement('time');
    time.textContent = new Date(entry.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    li.append(time, document.createTextNode(entry.message)); $('log').append(li);
  }
}
for (const side of ['a','b']) {
  $(side).addEventListener('change', () => guarded(saveSelection));
  $('config'+side.toUpperCase()).addEventListener('click', () => guarded(() => configure(side)));
}
$('refresh').onclick = () => guarded(loadTabs);
$('allow').onclick = () => guarded(async () => {if (!await permission([$('a').value,$('b').value])) throw new Error('Site access was not granted.'); $('status').textContent='Access granted for selected sites.';});
$('inspectMedia').onclick = () => guarded(async()=>{
  const result=await request({type:'inspectMedia',a:Number($('a').value),b:Number($('b').value)});
  fileOrigins=result.origins;$('allowMedia').hidden=!fileOrigins.length;
  $('mediaInfo').textContent=result.results.map((s,i)=>`Tab ${i?'B':'A'}: ${s.files.length? s.files.map(f=>f.name+(f.error?' — '+f.error:'')).join(', '):'no images/files detected'}`).join(' · ')+(fileOrigins.length?' · Extra file hosts: '+fileOrigins.join(', '):'');
});
$('allowMedia').onclick = () => guarded(async()=>{
  if(!fileOrigins.length)return;
  if(!await chrome.permissions.request({origins:fileOrigins}))throw new Error('Attachment host access was not granted.');
  $('mediaInfo').textContent='File-host access granted. Start a new relay after checking any drafts.';
});
$('existing').onchange = () => {$('seedLabel').hidden = $('existing').checked;};
$('closeConfig').onclick = () => {$('config').hidden = true; editing = null;};
$('saveProfile').onclick = () => guarded(async () => {await saveProfile(); $('sample').textContent = 'Controls saved. Test read access next.';});
$('test').onclick = () => guarded(async () => {
  await saveProfile(); const s = await request({type:'test', id:editing});
  $('sample').textContent = `${s.count} visible assistant reply elements · message box ${s.inputReady ? 'found' : 'MISSING / ambiguous / not editable'} (${s.inputCount} matches) · ${s.sendCount} send-button matches · ${s.busy ? 'generating' : 'idle'}\nAttachments: ${s.attachments.map(a=>a.name+(a.error?' — '+a.error:'')).join(', ') || 'none'}\nLatest reply sample:\n${s.text.slice(0,700) || '(no text; may be image/file-only)'}`;
});
$('start').onclick = () => guarded(async () => {
  if (!await permission([$('a').value,$('b').value])) throw new Error('Site access was not granted.');
  await saveSelection();
  await request({type:'start',a:Number($('a').value),b:Number($('b').value),limit:Number($('limit').value),seed:$('seed').value,existing:$('existing').checked});
  await render();
});
$('stop').onclick = () => guarded(async () => {await request({type:'stop'}); await render();});
chrome.storage.onChanged.addListener(() => {render().catch(showError);});
await guarded(async () => {
  await loadTabs(); await render();
  const {pendingPicker} = await chrome.storage.local.get('pendingPicker');
  if (pendingPicker) {
    const side = ['a','b'].find(s => Number($(s).value) === pendingPicker.id);
    if (side) await configure(side);
    await chrome.storage.local.remove('pendingPicker');
  }
});
// Faster checks while the popup is open; durable alarms continue after it closes.
setInterval(() => request({type:'tick'}).catch(showError), 2000);
