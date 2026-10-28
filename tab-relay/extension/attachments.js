export const MAX_FILE = 10 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024, MAX_FILES = 5;
export const permissionPattern = url => {const u=new URL(url);return u.protocol+'//'+u.hostname+'/*';};

export async function downloadExternal(item, sourceUrl, permissions, fetcher = fetch) {
  const url=new URL(item.url);
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Attachment URL type is not supported.');
  if(url.origin===new URL(sourceUrl).origin) throw new Error('Same-origin attachments must be read by the source tab.');
  if(!await permissions.contains({origins:[permissionPattern(url.href)]})) throw new Error(`Allow attachment access for ${url.origin} using “Check attachments”, then “Allow file hosts”.`);
  const response=await fetcher(url.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Attachment download failed (${response.status}): ${item.name}`);
  if(Number(response.headers.get('content-length'))>MAX_FILE)throw new Error('Attachment exceeds the 10 MB per-file limit.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Cannot read attachment bytes.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_FILE){await reader.cancel();throw new Error('Attachment exceeds the 10 MB per-file limit.');}chunks.push(value);}
  if(!size)throw new Error('Attachment is empty.');
  const mime=(response.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  if(mime==='text/html' && !/\.html?$/i.test(item.name))throw new Error('File URL returned a web/login page instead of the attachment.');
  if(item.kind==='image' && !mime.startsWith('image/'))throw new Error('Image URL returned a non-image response.');
  const binary=[];for(const chunk of chunks)for(let i=0;i<chunk.length;i+=32768)binary.push(String.fromCharCode(...chunk.subarray(i,i+32768)));
  const extension={'image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','image/avif':'avif'}[mime];
  const name=item.kind==='image' && /^image-\d+\.png$/.test(item.name) && extension ? item.name.replace(/png$/,extension):item.name;
  return {name,mime,size,base64:btoa(binary.join(''))};
}
