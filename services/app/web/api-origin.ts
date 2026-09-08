import {artifactReturnAddress, stripIntent, withIntent, type Intent} from '@/lib/intent';
import {isPlatformPage} from '@artifactbin/utils/platform-pages';

/** First-party router registration; returning false preserves native/server navigation. */
export type AppNavigation = (url: URL, replace: boolean) => boolean;
let navigation: AppNavigation | null = null;
export function bindAppNavigation(navigate: AppNavigation): () => void {
  navigation = navigate;
  return () => { if (navigation === navigate) navigation = null; };
}
/** Route admission is shared by explicit appNavigate and trusted anchor handling. */
export function isClientAppUrl(url: URL, origin: string): boolean {
  if (url.origin !== origin || url.username || url.password || url.searchParams.has('key')) return false;
  return isPlatformPage(url.pathname)
    || /^\/a\/[A-Za-z0-9]+\/?$/.test(url.pathname)
    || (/^\/@[\w-]+(?:\/[\w-]+)*\/?$/.test(url.pathname) && !/\/(?:raw|export)\/?$/.test(url.pathname));
}
export function tryAppNavigation(url: URL, replace = false): boolean {
  return clientMode === 'standalone' && window.parent === window && isClientAppUrl(url, window.location.origin) && !!navigation?.(url, replace);
}

/** Explicit client transport, never a patch to window.fetch. Config is server-owned. */
export function createAppApi(own: string, api: string | null, fetchImpl: typeof fetch) {
  const ownOrigin = new URL(own).origin;
  const mainOrigin = api ? new URL(api).origin : null;
  if (mainOrigin && !/^https?:\/\//.test(mainOrigin)) throw new Error('Invalid API origin');
  const url = (path: string): string => {
    if (!mainOrigin) return path;
    const parsed = new URL(path, own);
    if (parsed.origin !== ownOrigin) return path;
    const target = isPlatformPage(parsed.pathname) || parsed.pathname==='/oauth/authorize' || /^\/docs(?:\/|$)/.test(parsed.pathname) || /^\/(?:a\/|@|assets\/)/.test(parsed.pathname) ? mainOrigin : ownOrigin;
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
type ClientMode='standalone'|'controls'|'page'|'folder';
let clientMode:ClientMode='standalone';
let parentAddress: string | null = null;
const addressListeners = new Set<() => void>();
export const subscribeArtifactAddress = (listener: () => void) => {addressListeners.add(listener);return () => {addressListeners.delete(listener);};};
export const getArtifactAddress = (): string | null => clientMode==='controls' ? parentAddress : clientMode==='standalone' ? (typeof window==='undefined'?null:window.location.href) : configured?.url('') ?? (typeof window==='undefined'?null:window.location.href);
/** Installed before React mounts. The sender and the address each have their own check. */
export function receiveArtifactAddress(event: MessageEvent): void {
  if (clientMode!=='controls' || !configured?.mainOrigin || event.source !== window.parent || event.origin !== configured.mainOrigin || event.data?.type !== 'mx:controls:address') return;
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
  if (clientMode==='controls' && configured?.mainOrigin) {
    window.parent.postMessage({type:'mx:controls:consume-intent'}, configured.mainOrigin);
  } else {
    const next = stripIntent(window.location.search);
    if (next !== window.location.search) window.history.replaceState(null, '', window.location.pathname + next + window.location.hash);
  }
}
export function configureAppApi(own: string, api: string, mode:ClientMode='controls'): void {
  configured = createAppApi(own, api, (...args) => globalThis.fetch(...args));
  clientMode = mode;
  parentAddress = null;
}
export const appFetch: typeof fetch = (...args) => configured ? configured.fetch(...args)
  : createAppApi(window.location.origin, null, (...input) => globalThis.fetch(...input)).fetch(...args);
export const appUrl = (path: string): string => configured?.url(path) ?? path;
export const isControlsClient = (): boolean => clientMode==='controls';
export const isFolderClient = (): boolean => clientMode==='folder';
export function appNavigate(path: string, replace = false): void {
  if (navigation && tryAppNavigation(new URL(appUrl(path), window.location.href), replace)) return;
  if (!configured || window.parent === window) {if(replace)window.location.replace(appUrl(path));else window.location.href=appUrl(path);return;}
  const url = new URL(appUrl(path));
  if (url.origin !== configured.mainOrigin) {window.top!.location.href=url.href;return;}
  window.parent.postMessage({type:'mx:controls:navigate',url:url.href,...(replace?{replace:true}:{})},configured.mainOrigin!);
}
export const appEventSource = (path: string): EventSource => new EventSource(path);
