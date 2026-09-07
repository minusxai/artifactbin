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
export function configureAppApi(own: string, api: string, frame = true): void {
  configured = createAppApi(own, api, (...args) => globalThis.fetch(...args));
  controlsClient = frame;
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
