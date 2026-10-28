(() => {
  if (globalThis.__tabRelayMedia) return;
  const MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024, MAX_FILES = 5;
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const matches = (root, selector) => selector ? [...root.querySelectorAll(selector)] : [];
  const fileExtension = /\.(pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|json|xml|zip|7z|tar|gz|png|jpe?g|gif|webp|svg|avif|mp[34]|wav|webm|py|js|html|css|ipynb)(?:$|[?#])/i;
  const safeName = (name, fallback) => (name || fallback).split(/[\\/]/).at(-1).replace(/[\x00-\x1f<>:"|?*]/g, '_').slice(0,160) || fallback;
  const inlineSources=new Map();
  function inlineKey(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return `inline:${value.length}:${hash>>>0}`;}

  function collect(reply, profile) {
    inlineSources.clear();
    if (!reply) return [];
    const result = [], seen = new Set();
    const add = item => {
      if(item.url.startsWith('data:')){const raw=item.url;item.url=inlineKey(raw);inlineSources.set(item.url,raw);}
      if(!/^(https?:|blob:|inline:)/.test(item.url))item.error='This file uses an internal website link. A site-specific download adapter is required.';
      if (!seen.has(item.url)) {seen.add(item.url);result.push(item);}
    };
    const selected = profile.attachment ? matches(reply, profile.attachment) : [];
    const links = profile.attachment ? selected.filter(el => el.matches('a[href]')) : matches(reply,'a[href]').filter(el => el.hasAttribute('download') || fileExtension.test(el.getAttribute('href') || '') || fileExtension.test(el.innerText.trim()));
    for (const link of links) {
      const url = link.href;
      let leaf = ''; try {leaf = decodeURIComponent(new URL(url).pathname.split('/').at(-1));} catch {}
      const label=fileExtension.test(link.innerText.trim())?link.innerText.trim():'';
      add({url, name:safeName(link.getAttribute('download') || label || leaf, 'attachment.bin'), kind:'file', pending:false});
    }
    const images = profile.attachment ? selected.filter(el => el.matches('img')) : matches(reply,'img').filter(img => {
      const r = img.getBoundingClientRect();
      return visible(img) && (Math.max(img.naturalWidth, img.naturalHeight, r.width, r.height) >= 96 || !img.complete);
    });
    for (const img of images) {
      const parent = img.closest('a[href]');
      if (parent && seen.has(parent.href)) continue;
      const url = img.currentSrc || img.src;
      if (!url) continue;
      let leaf = ''; try {leaf = decodeURIComponent(new URL(url).pathname.split('/').at(-1));} catch {}
      const suffix = /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(leaf) ? leaf : `image-${result.length+1}.png`;
      add({url, name:safeName(suffix,'image.png'), kind:'image', pending:!img.complete, error:img.complete && !img.naturalWidth ? 'An image failed to load.' : ''});
    }
    const svgs = profile.attachment ? selected.filter(el => el.matches('svg')) : matches(reply,'svg').filter(el => {
      const r=el.getBoundingClientRect();return visible(el) && r.width>=96 && r.height>=96;
    });
    for (const svg of svgs) {
      const markup = new XMLSerializer().serializeToString(svg);
      add({url:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup), name:`diagram-${result.length+1}.svg`, kind:'image', pending:false});
    }
    const buttons=matches(reply,'button').filter(el=>visible(el) && /download|save file/i.test((el.getAttribute('aria-label') || '')+' '+(el.innerText || '')));
    for(const [i,button] of buttons.entries()){
      let parent=button.parentElement,associated=false;
      for(let depth=0;depth<3 && parent && parent!==reply;depth++,parent=parent.parentElement){
        if(matches(parent,'img').some(img=>images.includes(img)) && matches(parent,'img').length===1){associated=true;break;}
      }
      if(!associated)add({url:`unsupported:download-button-${i}`,name:'Download button',kind:'file',pending:false,error:'This reply exposes a download button without a file URL. A site-specific download adapter is required.'});
    }
    return result;
  }

  function draft(profile) {
    const selected = matches(document,profile.upload || 'input[type="file"]').filter(el => el.type==='file').reduce((n,el)=>n+(el.files?.length || 0),0);
    const previews = matches(document,profile.uploaded).filter(visible).length;
    return Math.max(selected,previews);
  }
  async function read(item, signal) {
    const actual=item.url.startsWith('inline:')?inlineSources.get(item.url):item.url;
    if(!actual)throw new Error('Inline attachment is no longer available.');
    const url=new URL(actual,location.href);
    if (!['http:','https:','data:','blob:'].includes(url.protocol)) throw new Error(`Cannot download ${item.name}: this website exposes an internal link. A site-specific download adapter is required.`);
    if (['http:','https:'].includes(url.protocol) && url.origin!==location.origin) throw new Error('Cross-site attachments require an explicit host permission.');
    const response = await fetch(url.href,{credentials:'same-origin',redirect:'error',signal});
    if (!response.ok) throw new Error(`Attachment download failed (${response.status}): ${item.name}`);
    const declared=Number(response.headers.get('content-length'));
    if (declared>MAX_FILE) throw new Error('Attachment exceeds the 10 MB per-file limit.');
    const reader=response.body?.getReader();
    if (!reader) throw new Error('Cannot read attachment bytes.');
    const chunks=[];let size=0;
    while (true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_FILE){await reader.cancel();throw new Error('Attachment exceeds the 10 MB per-file limit.');}
      chunks.push(value);
    }
    if(!size)throw new Error(`Attachment is empty: ${item.name}`);
    const mime=(response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    if (mime==='text/html' && !/\.html?$/i.test(item.name)) throw new Error('The file URL returned a web/login page rather than the attachment.');
    if(item.kind==='image' && !mime.startsWith('image/'))throw new Error('The image URL returned a non-image response.');
    const blob=new Blob(chunks,{type:mime});
    const base64=await new Promise((resolve,reject)=>{const f=new FileReader();f.onerror=()=>reject(Error('Cannot encode attachment'));f.onload=()=>resolve(f.result.split(',')[1]);f.readAsDataURL(blob);});
    const extension={'image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif'}[mime];
    const name=item.kind==='image' && /^image-\d+\.png$/.test(item.name) && extension ? item.name.replace(/png$/,extension):item.name;
    return {name,mime,size,base64};
  }

  async function upload(profile, files, assertActive) {
    if (!files?.length) return;
    if(files.length>MAX_FILES || files.some(f=>f.size>MAX_FILE) || files.reduce((n,f)=>n+f.size,0)>MAX_TOTAL) throw new Error('Attachment limit: 5 files, 10 MB each, 20 MB total.');
    if(!profile.uploaded || !profile.uploadPending) throw new Error('Configure uploaded-file previews and upload-progress selectors for the receiving site before relaying attachments.');
    const inputs=matches(document,profile.upload || 'input[type="file"]').filter(el=>el instanceof HTMLInputElement && el.type==='file');
    if(inputs.length!==1 || inputs[0].disabled) throw new Error('Configure exactly one enabled file-upload input (it may be hidden).');
    const input=inputs[0];
    if(files.length>1 && !input.multiple) throw new Error('This upload control accepts only one file. The reply contains several attachments.');
    if(draft(profile))throw new Error('The receiving chat already contains attachments. Nothing was overwritten.');
    const transfer=new DataTransfer();
    for(const file of files){
      const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
      if(bytes.length!==file.size)throw new Error('Attachment bytes failed size verification.');
      transfer.items.add(new File([bytes],safeName(file.name,'attachment.bin'),{type:file.mime}));
    }
    assertActive();input.files=transfer.files;
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    let readySince=0;
    const started=Date.now();
    while(Date.now()-started<60000){
      assertActive();
      const ready=uploadState(profile,files).ready;
      if(ready){if(!readySince)readySince=Date.now();if(Date.now()-readySince>=1500)return;}
      else readySince=0;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('Upload readiness could not be confirmed within 60 seconds. Check the attachments; no send was attempted.');
  }
  function uploadState(profile,files){
    const previews=matches(document,profile.uploaded).filter(visible);
    const pending=matches(document,profile.uploadPending).filter(visible).length;
    const fold=value=>(value || '').normalize('NFKC').toLowerCase();
    const remaining=previews.map(el=>fold([el.innerText || el.textContent,el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('data-filename'),...matches(el,'[aria-label],[title],[alt],[data-filename]').map(child=>[child.getAttribute('aria-label'),child.getAttribute('title'),child.getAttribute('alt'),child.getAttribute('data-filename')].join(' '))].join(' ')));
    let named=true;
    for(const file of files){const index=remaining.findIndex(text=>text.includes(fold(safeName(file.name,'attachment.bin'))));if(index<0){named=false;break;}remaining.splice(index,1);}
    return {ready:!pending && previews.length===files.length && named,pending,previewCount:previews.length,named};
  }
  function assertUploads(profile,files){
    if(!files?.length)return;
    const state=uploadState(profile,files);
    if(!state.ready)throw new Error('Attachments changed, are still uploading, or their filenames cannot be verified. No send was attempted.');
    const inputs=matches(document,profile.upload || 'input[type="file"]').filter(el=>el.type==='file');
    if(inputs.length!==1)throw new Error('The file-upload control changed before send.');
    const selected=[...inputs[0].files];
    if(selected.length && (selected.length!==files.length || selected.some((file,i)=>file.name!==safeName(files[i].name,'attachment.bin') || file.size!==files[i].size)))throw new Error('Selected files changed before send.');
  }
  globalThis.__tabRelayMedia={collect,draft,read,upload,assertUploads,MAX_FILE,MAX_TOTAL,MAX_FILES};
})();
