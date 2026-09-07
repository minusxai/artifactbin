import {artifactReturnAddress, stripIntent, withIntent, type Intent} from '@/lib/intent';

/** Explicit client transport, never a patch to window.fetch. Config is server-owned. */
export function createAppApi(own: string, api: string | null, fetchImpl: typeof fetch) {
  const ownOrigin = new URL(own).origin;
  const mainOrigin = api ? new URL(api).origin : null;
  if (mainOrigin && !/^https?:\/\//.test(mainOrigin)) throw new Error('Invalid API origin');
  const url = (path: string): string => {
    if (!mainOrigin) return path;
    const parsed = new URL(path, ownOrigin);
    if (parsed.origin !== ownOrigin) return path;
    const target = /^\/(?:a\/|@|assets\/)/.test(parsed.pathname) ? mainOrigin : ownOrigin;
    return `${target}${parsed.pathname}${parsed.search}${parsed.hash}`;
  };
  const fetch: typeof globalThis.fetch = (input, init) => {
    const original = input instanceof Request ? input.url : String(input);
    if (new URL(original, ownOrigin).origin !== ownOrigin) return fetchImpl(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-artifactbin-csrf', '1');
    return fetchImpl(input, {...init, headers});
  };
  return {fetch, url, mainOrigin};
}

let configured: ReturnType<typeof createAppApi> | null = null;
let controlsClient = false;
let parentAddress: string | null = null;
const addressListeners = new Set<() => void>();
export const subscribeArtifactAddress = (listener: () => void) => {addressListeners.add(listener);return () => {addressListeners.delete(listener);};};
export const getArtifactAddress = (): string | null => controlsClient ? parentAddress : `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
/** Installed before React mounts. The sender and the address each have their own check. */
export function receiveArtifactAddress(event: MessageEvent): void {
  if (!controlsClient || !configured?.mainOrigin || event.source !== window.parent || event.origin !== configured.mainOrigin || event.data?.type !== 'mx:controls:address') return;
  const id = window.location.pathname.match(/^\/controls\/a\/([^/]+)$/)?.[1];
  if (!id) return;
  const next = artifactReturnAddress(event.data.url, configured.mainOrigin, id);
  if (!next || next === parentAddress) return;
  parentAddress = next;
  for (const listener of addressListeners) listener();
}
export function artifactLoginUrl(id: string, intent: Intent): string {
  const address = getArtifactAddress() ?? appUrl(`/a/${id}`);
  const parsed = new URL(address, window.location.origin);
  // Login's existing internal redirect validator accepts a relative path;
  // appUrl maps /a and /@ back to main after the account session is established.
  const callback = `${parsed.pathname}${withIntent(parsed.search, intent)}${parsed.hash}`;
  return `/login?callbackUrl=${encodeURIComponent(callback)}`;
}
export function consumeArtifactIntent(): void {
  if (controlsClient && configured?.mainOrigin) {
    window.parent.postMessage({type:'mx:controls:consume-intent'}, configured.mainOrigin);
  } else {
    const next = stripIntent(window.location.search);
    if (next !== window.location.search) window.history.replaceState(null, '', window.location.pathname + next + window.location.hash);
  }
}
export function configureAppApi(own: string, api: string, frame = true): void {
  configured = createAppApi(own, api, (...args) => globalThis.fetch(...args));
  controlsClient = frame;
  parentAddress = null;
}
export const appFetch: typeof fetch = (...args) => configured ? configured.fetch(...args)
  : createAppApi(window.location.origin, null, (...input) => globalThis.fetch(...input)).fetch(...args);
export const appUrl = (path: string): string => configured?.url(path) ?? path;
export const isControlsClient = (): boolean => controlsClient;
export function appNavigate(path: string): void {
  if (!configured || window.parent === window) {window.location.href=appUrl(path);return;}
  const url = new URL(appUrl(path));
  if (url.origin !== configured.mainOrigin) {window.top!.location.href=url.href;return;}
  window.parent.postMessage({type:'mx:controls:navigate',url:url.href},configured.mainOrigin!);
}
export const appEventSource = (path: string): EventSource => new EventSource(path);
