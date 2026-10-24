import { LOCAL_PUBLICATION_MESSAGE, type LocalPublicationReceipt } from './contracts';

export function publicationPlatformOrigin(value: string): string {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname.endsWith('.lvh.me');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || !(url.protocol === 'https:' || url.protocol === 'http:' && local)) throw new Error('Choose an HTTPS platform origin, or a loopback development origin.');
  return url.origin;
}
function receiptOf(value: unknown, origin: string): LocalPublicationReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Partial<LocalPublicationReceipt>, identity = r.identity;
  if (!identity || typeof identity.artifactId !== 'string' || typeof identity.baseRevision !== 'string' || typeof identity.sourceDigest !== 'string' || identity.platformOrigin !== origin || !/^[A-Za-z0-9]{6}$/.test(identity.artifactId) || !/^\d+$/.test(identity.baseRevision) || !/^[a-f0-9]{64}$/.test(identity.sourceDigest) || typeof r.source !== 'string' || r.source.length > 4_000_000) return null;
  const dependencies = r.dependencyIdentity ?? identity.dependencyIdentity;
  if (dependencies && (typeof dependencies !== 'object' || Array.isArray(dependencies) || Object.values(dependencies).some(id => typeof id !== 'string'))) return null;
  return { identity: { platformOrigin: origin, artifactId: identity.artifactId, baseRevision: identity.baseRevision, sourceDigest: identity.sourceDigest, ...(dependencies ? { dependencyIdentity: dependencies } : {}) }, source: r.source, ...(dependencies ? { dependencyIdentity: dependencies } : {}) };
}
/** Called only from the local document's Publish click; no credentials or file reads happen here. */
export function publishLocalDocument(options: { win: Window; platformOrigin: string; onPublished: (receipt: LocalPublicationReceipt) => void }): { dispose(): void } {
  const origin = publicationPlatformOrigin(options.platformOrigin), nonce = crypto.randomUUID();
  const url = new URL('/local/publish', origin);
  url.hash = new URLSearchParams({ af_nonce: nonce, af_opener: options.win.location.origin }).toString();
  let port: MessagePort | undefined, done = false;
  const dispose = () => { done = true; options.win.removeEventListener('message', ready); options.win.removeEventListener('pagehide', dispose); port?.close(); };
  const ready = (event: MessageEvent) => {
    if (done || event.source !== popup || event.origin !== origin || event.data?.type !== LOCAL_PUBLICATION_MESSAGE || event.data.kind !== 'ready' || event.data.nonce !== nonce) return;
    port?.close();
    const channel = new MessageChannel(); port = channel.port1;
    port.onmessage = message => {
      if (done || message.data?.type !== LOCAL_PUBLICATION_MESSAGE || message.data.kind !== 'published' || message.data.nonce !== nonce) return;
      const receipt = receiptOf(message.data.receipt, origin);
      if (receipt) { dispose(); options.onPublished(receipt); }
    };
    popup!.postMessage({ type: LOCAL_PUBLICATION_MESSAGE, kind: 'connect', nonce }, origin, [channel.port2]);
  };
  const popup = options.win.open(url.href, '_blank', 'popup,width=720,height=840');
  if (!popup) throw new Error('Allow the publication popup, then press Publish again.');
  options.win.addEventListener('message', ready);
  options.win.addEventListener('pagehide', dispose, { once: true });
  return { dispose };
}
/** The trusted platform page accepts one connection from its original local opener. */
export function receiveLocalPublication(options: { win: Window; onConnected?: () => void }): { send(receipt: LocalPublicationReceipt): boolean; dispose(): void } {
  const params = new URLSearchParams(options.win.location.hash.slice(1));
  const nonce = params.get('af_nonce'), openerOrigin = params.get('af_opener'), opener = options.win.opener;
  let port: MessagePort | undefined;
  const dispose = () => { options.win.removeEventListener('message', connect); port?.close(); port = undefined; };
  const connect = (event: MessageEvent) => {
    if (!nonce || !openerOrigin || event.source !== opener || event.origin !== openerOrigin || event.data?.type !== LOCAL_PUBLICATION_MESSAGE || event.data.kind !== 'connect' || event.data.nonce !== nonce || !event.ports[0]) return;
    port?.close(); port = event.ports[0]; options.onConnected?.();
  };
  let validOrigin = openerOrigin === 'null';
  try { validOrigin ||= !!openerOrigin && new URL(openerOrigin).origin === openerOrigin; } catch { /* malformed handoff: publish without returning bytes */ }
  if (opener && nonce && /^[A-Za-z0-9_-]{16,128}$/.test(nonce) && openerOrigin && validOrigin) {
    options.win.addEventListener('message', connect);
    opener.postMessage({ type: LOCAL_PUBLICATION_MESSAGE, kind: 'ready', nonce }, openerOrigin === 'null' ? '*' : openerOrigin);
  }
  return { dispose, send(receipt) { if (!port || !nonce || !receiptOf(receipt, options.win.location.origin)) return false; port.postMessage({ type: LOCAL_PUBLICATION_MESSAGE, kind: 'published', nonce, receipt }); return true; } };
}
