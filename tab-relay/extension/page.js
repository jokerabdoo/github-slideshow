(() => {
  if (globalThis.__tabRelayInstalled) return;
  globalThis.__tabRelayInstalled = true;
  const visible = el => !!el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const all = selector => selector ? [...document.querySelectorAll(selector)].filter(visible) : [];
  const last = selector => all(selector).at(-1);
  const isDisabled = el => el?.disabled || el?.getAttribute('aria-disabled') === 'true';
  const editable = el => !!el && !isDisabled(el) && !el.readOnly && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text','search'].includes(el.type)));
  const textOf = el => (el?.innerText || el?.textContent || '').trim();
  const media = globalThis.__tabRelayMedia;

  function snapshot(profile) {
    const detected=profile.auto?globalThis.__tabRelayDetect.resolve():null;
    const replies = all(profile.reply);
    const inputs = all(profile.input), sends = all(profile.send);
    const input = inputs.at(-1), send = sends.at(-1);
    const busy = profile.busy ? all(profile.busy).length > 0 : false;
    const reply = replies.at(-1);
    const attachments = media.collect(reply,profile);
    // Covers common accessibility signals in addition to the configured stop control.
    const streaming = reply?.getAttribute('aria-busy') === 'true' || !!reply?.querySelector('[aria-busy="true"]');
    return {text: textOf(reply), diagnostics:detected?{replyDetection:detected.replyDetection}:null, attachments, assetsReady:!attachments.some(a=>a.pending), draftAttachments:media.draft(profile), count: replies.length, busy: busy || streaming,
      inputReady: inputs.length === 1 && editable(input), sendReady: sends.length === 1 && !!send && !isDisabled(send),
      inputCount: inputs.length, sendCount: sends.length,
      inputText: input ? ('value' in input ? input.value : textOf(input)) : '', url: location.href};
  }

  let cancelled = false;
  let sending = false;
  async function send(profile, text, expectedUrl, attachments = []) {
    if (sending) throw new Error('A send is already in progress in this tab. Check the chat before restarting.');
    sending = true; cancelled = false;
    if(profile.auto)globalThis.__tabRelayExpectedFiles=attachments.map(file=>file.name);
    const heartbeat=setInterval(()=>chrome.runtime.sendMessage({type:'heartbeat'}).catch(()=>{}),10000);
    try {return await performSend(profile, text, expectedUrl, attachments);} finally {clearInterval(heartbeat);sending = false;globalThis.__tabRelayExpectedFiles=[];}
  }
  async function performSend(profile, text, expectedUrl, attachments) {
    const startUrl = expectedUrl || location.href;
    if (location.href !== startUrl) throw new Error('The receiving tab navigated. No send was attempted.');
    const before = snapshot(profile);
    if (before.busy) throw new Error('The receiving chat is still generating.');
    if (!before.inputReady) throw new Error(profile.auto?'Could not identify one editable message box automatically. Open the chat conversation and try again.':'Select exactly one editable message box. Configure this tab.');
    if (before.inputText.trim() || before.draftAttachments) throw new Error('The receiving message box contains a draft or attachments. Clear or send them yourself first.');
    const assertActive=()=>{
      if(cancelled)throw new Error('Relay stopped before send. Check any unsent draft/attachments.');
      if(location.href!==startUrl)throw new Error('The receiving tab navigated before send.');
      if(snapshot(profile).busy)throw new Error('The receiving chat started generating before send.');
    };
    await media.upload(profile,attachments,assertActive);
    assertActive();
    if(snapshot(profile).inputText.trim())throw new Error('A draft appeared while files were uploading. Your text was preserved; no send was attempted.');
    const input = last(profile.input);
    if(!editable(input))throw new Error('The message box changed during upload. No send was attempted.');
    input.focus();
    if (!text && attachments.length) {
      // Image-only and file-only replies are valid; do not invent a text caption.
    } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, text);
      input.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    } else if (input.isContentEditable) {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges(); selection.addRange(range);
      // Browser editing preserves rich editors' internal transaction/input handling.
      if (!document.execCommand('insertText', false, text)) {
        throw new Error('This editor rejected text insertion. No send was attempted.');
      }
    } else throw new Error('Selected message box is not editable.');
    await new Promise(resolve => setTimeout(resolve, 650));
    if (cancelled) throw new Error('Relay stopped before send. Check the unsent draft.');
    if (location.href !== startUrl) throw new Error('The receiving tab navigated before send. Check the unsent draft.');
    const final = snapshot(profile);
    if (!input.isConnected || last(profile.input) !== input || !final.inputReady) throw new Error('The message box changed before send. Check the unsent draft.');
    if (final.busy) throw new Error('The receiving chat started generating before send. Check the unsent draft.');
    const inserted = final.inputText;
    if (inserted.replace(/\s+/g, ' ').trim() !== text.replace(/\s+/g, ' ').trim()) {
      throw new Error('Could not verify the inserted message. Check the draft; no send was attempted.');
    }
    media.assertUploads(profile,attachments);
    const button = last(profile.send);
    if (!final.sendReady || !button.matches('button,[role="button"],input[type="submit"],input[type="button"]')) throw new Error('Select exactly one enabled send button. Your draft was left in place.');
    button.click(); // Exactly one attempt. The background pauses on uncertain delivery.
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const after=snapshot(profile);
      if (!after.inputText.trim() && (!attachments.length || !after.draftAttachments)) return {accepted: true};
    }
    throw new Error('Send was clicked but delivery could not be confirmed. Check the chat before starting again.');
  }

  function selectorFor(el, role) {
    if (role === 'reply') {
      const author = el.closest('[data-message-author-role="assistant"]');
      if (author) return '[data-message-author-role="assistant"]';
    }
    for (const attr of ['data-testid', 'data-message-author-role', 'aria-label']) {
      if (el.getAttribute(attr)) return `${el.tagName.toLowerCase()}[${attr}=${JSON.stringify(el.getAttribute(attr))}]`;
    }
    if (!['reply','attachment','uploaded','uploadPending'].includes(role) && el.id) return `#${CSS.escape(el.id)}`;
    const classes = [...el.classList].filter(c => !/active|hover|focus|selected|loading/i.test(c));
    if (classes.length) return el.tagName.toLowerCase() + classes.slice(0, 4).map(c => '.' + CSS.escape(c)).join('');
    if (role === 'input' && el.isContentEditable) return '[contenteditable="true"]';
    return el.tagName.toLowerCase();
  }

  let cancelPicker;
  function pick(role) {
    cancelPicker?.();
    const tip = document.createElement('div');
    tip.textContent = `Tab Relay: click the ${role === 'busy' ? 'stop-generating button (while generating)' : role}. Esc cancels.`;
    Object.assign(tip.style, {position:'fixed', top:'12px', left:'12px', zIndex:'2147483647', background:'#142235', color:'white', padding:'14px 20px', borderRadius:'12px', font:'15px system-ui', pointerEvents:'none', boxShadow:'0 4px 30px #0006'});
    document.documentElement.append(tip);
    let highlighted, oldOutline;
    const reset = () => {if (highlighted) highlighted.style.outline = oldOutline;};
    const move = e => {reset(); highlighted = e.target; oldOutline = highlighted.style.outline; highlighted.style.outline = '3px solid #14b8a6';};
    const cleanup = () => {reset(); tip.remove(); document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); cancelPicker = null;};
    const key = e => {if (e.key === 'Escape') cleanup();};
    const click = async e => {
      e.preventDefault(); e.stopImmediatePropagation();
      let el = e.target;
      if (role === 'input') el = el.closest('textarea,input,[contenteditable="true"]') || el;
      if (role === 'send' || role === 'busy') el = el.closest('button,[role="button"]') || el;
      const selector = selectorFor(el, role);
      cleanup();
      await chrome.runtime.sendMessage({type: 'picked', role, selector});
    };
    cancelPicker = cleanup;
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return {picking: true};
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === 'halt') {
      cancelled=true;
      const profile=message.profile?.auto?globalThis.__tabRelayDetect.resolve():message.profile;
      const buttons=profile?all(profile.busy).filter(el=>!isDisabled(el)):[];
      buttons.forEach(button=>button.click());respond({ok:true,attempted:buttons.length});return;
    }
    if (message.type === 'cancel') {cancelled = true; respond({ok:true}); return;}
    if (!['snapshot', 'send', 'pick', 'readAttachment','detect'].includes(message.type)) return;
    Promise.resolve().then(() => {
      if(message.type==='detect')return {profile:globalThis.__tabRelayDetect.resolve()};
      if (message.type === 'snapshot') return snapshot(message.profile);
      if (message.type === 'send') return send(message.profile, message.text, message.expectedUrl, message.attachments);
      if (message.type === 'readAttachment') {
        if(location.href!==message.expectedUrl)throw new Error('Source tab navigated before reading its attachment.');
        const current=snapshot(message.profile);
        const item=current.attachments.find(a=>a.url===message.item.url && a.name===message.item.name);
        if(!item || item.error || item.pending)throw new Error(item?.error || 'Source attachment is no longer ready or available.');
        return media.read(item,AbortSignal.timeout(20000)).then(file=>({file}));
      }
      return pick(message.role);
    }).then(result => respond({ok: true, ...result}), error => respond({ok: false, error: error.message}));
    return true;
  });
})();
