(() => {
  if (globalThis.__tabRelayDetect) return;
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const list = (selector, root=document) => [...root.querySelectorAll(selector)];
  const label = el => [el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('data-testid'),el.innerText].filter(Boolean).join(' ').trim();
  const disabled = el => el.disabled || el.getAttribute('aria-disabled')==='true';
  const selectors = Object.fromEntries(['input','reply','send','busy','upload','uploaded','uploadPending'].map(role=>[role,`[data-tab-relay-${role}="true"]`]));
  function mark(role,elements){list(selectors[role]).forEach(el=>el.removeAttribute('data-tab-relay-'+role));elements.forEach(el=>el.setAttribute('data-tab-relay-'+role,'true'));}
  function uniqueBest(entries){entries.sort((a,b)=>b.score-a.score);if(!entries.length || entries[0].score<=0 || entries[1]?.score===entries[0].score)return null;return entries[0].el;}
  function resolve(){
    const host=location.hostname;
    const kind=/^(chatgpt\.com|chat\.openai\.com)$/.test(host)?'ChatGPT':/(^|\.)muse\.ai$/.test(host)?'Muse':'Chat';
    const inputs=list('textarea,[contenteditable="true"],[role="textbox"]').filter(el=>visible(el) && !el.closest('[data-tab-relay-reply="true"]') && (el.tagName==='TEXTAREA' || el.isContentEditable));
    const composer=uniqueBest(inputs.map(el=>({el,score:(el.id==='prompt-textarea'?120:0)+(/prompt|message|chat|ask|muse|send|type/i.test(label(el)+' '+el.getAttribute('placeholder'))?50:0)+(el.closest('form')?20:0)+30-(/search|find|filter/i.test(label(el)+' '+el.getAttribute('placeholder'))?150:0)})));
    mark('input',composer?[composer]:[]);
    const replyGroups=[
      '[data-message-author-role="assistant"]','[data-role="assistant"],[data-role="model"]',
      '[data-message-role="assistant"],[data-message-role="model"]','[data-sender="assistant"],[data-sender="ai"]',
      '[data-is-user="false"]','.assistant-message,.message.assistant,.chat-message.assistant,.ai-message,.assistant',
      '[data-testid="assistant-message"],[data-testid="chat-message-assistant"]',
      '[aria-label="Assistant response"],[aria-label="Muse response"]'
    ];
    let replies=[];
    for(const selector of replyGroups){const found=list(selector).filter(visible);if(found.length){replies=found;break;}}
    // A markdown wrapper is used only when it is explicitly in a non-user message row.
    if(!replies.length)replies=list('[data-message] .prose,[data-message] .markdown,.message-row .prose').filter(el=>visible(el) && !el.closest('[data-role="user"],[data-message-author-role="user"],[data-is-user="true"],.user-message,.message.user') && /assistant|model|ai-response|justify-start/.test(el.closest('[data-message],.message-row')?.className || ''));
    mark('reply',replies);
    let scope=composer?.closest('form,[data-testid="composer"],[data-composer]') || composer?.parentElement;
    if(scope && !scope.querySelector('button') && scope.parentElement)scope=scope.parentElement;
    const buttons=list('button,[role="button"],input[type="submit"]').filter(visible);
    const stops=buttons.filter(el=>!disabled(el) && (/stop (generating|streaming|response|generation)|stop-button|stop_response|cancel generation/i.test(label(el)) || (/^stop$/i.test(label(el)) && scope?.contains(el))));
    mark('busy',stops);
    const send=uniqueBest(buttons.filter(el=>!stops.includes(el)).map(el=>({el,score:
      (/^(send|send message|send prompt|submit message|submit prompt)$/i.test(label(el))?90:0)+
      (/send[-_ ](button|message|prompt)|submit[-_ ](button|message)/i.test(label(el))?75:0)+
      (el.type==='submit' && scope?.contains(el)?60:0)+
      (/send|arrow-up|arrowup|paper-plane/.test(el.querySelector('svg')?.getAttribute('data-lucide') || el.querySelector('svg')?.getAttribute('class') || '') && scope?.contains(el)?50:0)+
      (/\bsend\b|\bsubmit\b/i.test(label(el)) && scope?.contains(el)?25:0)
    })));
    mark('send',send?[send]:[]);
    const uploads=list('input[type="file"]').filter(el=>!disabled(el));
    const uploader=uniqueBest(uploads.map(el=>({el,score:10+(scope?.contains(el)?60:0)+(el.multiple?10:0)+(!el.accept || /pdf|document|\*/i.test(el.accept)?30:0)})));
    mark('upload',uploader?[uploader]:[]);
    const inComposer=el=>!el.closest(selectors.reply) && (scope?.contains(el) || (!scope?.closest('form') && composer?.parentElement?.contains(el)));
    let previews=list('[data-testid="file-upload-chip"],[data-testid="attachment-preview"],[data-testid*="file-preview"],.upload-chip,.attachment-preview,[data-upload-state="complete"]').filter(el=>visible(el) && inComposer(el));
    const expected=globalThis.__tabRelayExpectedFiles || [];
    if(expected.length){
      const searchRoot=scope || document;
      const fileLabels=list('span,p,[aria-label],[title],[data-filename],img[alt]',searchRoot).filter(el=>visible(el) && inComposer(el) && expected.some(name=>[el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('data-filename'),el.getAttribute('alt'),el.children.length===0?el.textContent:''].some(value=>value?.trim()===name)));
      previews.push(...fileLabels);
    }
    previews=[...new Set(previews)].filter(el=>!previews.some(other=>other!==el && el.contains(other)));
    mark('uploaded',previews);
    const progress=list('[role="progressbar"],.upload-progress,[data-upload-state="uploading"],[aria-label*="uploading" i],.upload-spinner').filter(el=>visible(el) && inComposer(el));
    mark('uploadPending',progress);
    return {...selectors,attachment:'',auto:true,kind};
  }
  globalThis.__tabRelayDetect={resolve};
})();
