export const normalize = text => (text || '').replace(/\r\n/g, '\n').trim();
export const contentKey = snapshot => normalize(snapshot.text) + ((snapshot.attachments || []).length ? '\n' + JSON.stringify(snapshot.attachments.map(a=>({url:a.url,name:a.name,kind:a.kind,pending:a.pending,error:a.error || ''}))) : '');
export const hasContent = snapshot => !!normalize(snapshot.text) || !!snapshot.attachments?.length;

// Stability is necessary as many chat pages stream text into an existing node.
export function observe(previous, snapshot, now, quietMs = 8000) {
  const text = normalize(snapshot.text);
  const key = contentKey(snapshot);
  if (!hasContent(snapshot) || snapshot.busy || snapshot.assetsReady === false || !snapshot.inputReady) return {text, key, since: now, blocked: true, ready: false};
  const unchanged = previous && (previous.key ?? previous.text) === key && !previous.blocked;
  const since = unchanged ? previous.since : now;
  return {text, key, since, blocked: false, ready: unchanged && now - since >= quietMs};
}

export function newReply(baseline, current) {
  return contentKey(current) !== contentKey(baseline) || current.count > baseline.count;
}

export function validateRun(a, b, limit, seed, existing) {
  if (!a || !b || a === b) throw new Error('Choose two different chat tabs.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Choose 1–100 messages.');
  if (!existing && !normalize(seed)) throw new Error('Enter an opening message or choose the latest reply.');
}
