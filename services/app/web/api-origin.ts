/** Explicit client transport, never a patch to window.fetch. Config is server-owned. */
export function createAppApi(own: string, api: string | null, fetchImpl: typeof fetch) {
  const ownOrigin = new URL(own).origin;
  const apiOrigin = api ? new URL(api).origin : null;
  if (apiOrigin && !/^https?:\/\//.test(apiOrigin)) throw new Error('Invalid API origin');
  const url = (path: string): string => {
    if (!apiOrigin) return path;
    const parsed = new URL(path, ownOrigin);
    return parsed.origin === ownOrigin ? `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}` : path;
  };
  const fetch: typeof globalThis.fetch = (input, init) => {
    const original = input instanceof Request ? input.url : String(input);
    const target = url(original);
    if (!apiOrigin || new URL(target, ownOrigin).origin !== apiOrigin) return fetchImpl(input, init);
    const request = input instanceof Request ? new Request(target, input) : target;
    const credentials = init?.credentials ?? (input instanceof Request ? input.credentials : undefined);
    return fetchImpl(request, {...init, credentials: credentials === 'omit' ? 'omit' : 'include'});
  };
  return {fetch, url};
}

let configured: ReturnType<typeof createAppApi> | null = null;
export function configureAppApi(own: string, api: string): void {
  configured = createAppApi(own, api, (...args) => globalThis.fetch(...args));
}
export const appFetch: typeof fetch = (...args) => configured ? configured.fetch(...args) : globalThis.fetch(...args);
export const appUrl = (path: string): string => configured?.url(path) ?? path;
export const isControlsClient = (): boolean => configured !== null;
export function appNavigate(path: string): void {
  if (!configured || window.parent === window) {window.location.href=appUrl(path);return;}
  const url = new URL(appUrl(path));
  window.parent.postMessage({type:'mx:controls:navigate',url:url.href},new URL(appUrl('/')).origin);
}
export const appEventSource = (path: string): EventSource => configured ? new EventSource(appUrl(path), {withCredentials:true}) : new EventSource(path);
