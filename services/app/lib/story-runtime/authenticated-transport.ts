import type { QueryTransport } from './store';
import type { DataflowState } from '@/lib/story/dataflow';

/** The authenticated page's existing query/mutation/assets doors, scoped to one document lifetime. */
export function createAuthenticatedTransport(id: string, fetcher: typeof fetch = fetch): QueryTransport & {dispose():void} {
  const controller = new AbortController();
  const base = `/a/${encodeURIComponent(id)}`;
  const request = async (path: string, init: RequestInit = {}, asset = false) => {
    controller.signal.throwIfAborted();
    const response = await fetcher(path, { ...init, credentials:'same-origin', signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal });
    controller.signal.throwIfAborted();
    const body = asset ? await response.json().catch(() => ({error:'fetch_failed'})) : await response.json();
    controller.signal.throwIfAborted();
    if (!response.ok && !asset) throw new Error(body.detail ?? body.error ?? `request failed (${response.status})`);
    return body;
  };
  const post = (path: string, body: unknown) => request(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const query = (body: unknown): Promise<Pick<DataflowState,'tables'|'errors'|'mutationAccess'>> => post(`${base}/query`, body);
  return {
    dispose: () => controller.abort(),
    run: (values, only, localTables) => query({values,only,...(localTables ? {localTables} : {})}),
    page: async (values, name, page, localTables) => {
      const result = await query({values,only:[name],page:{name,...page},...(localTables ? {localTables} : {})});
      if (!result.tables[name]) throw new Error(result.errors[name] ?? `no rows for ${name}`);
      return result.tables[name];
    },
    mutate: async (values, mutation, row, localTables) => {
      const result = await post(`${base}/mutate`, {values,mutation,...(row ? {row} : {}),...(localTables ? {localTables} : {})});
      if (!result.ok) throw new Error(result.detail ?? result.error ?? 'write failed');
      return {dataset:result.dataset ?? '',...(result.local ? {local:result.local} : {})};
    },
    importAsset: async (url, kind, signal) => {
      const query = new URLSearchParams({u:url,...(kind ? {kind} : {})});
      const result = await request(`${base}/assets?${query}`, {headers:{Accept:'application/json'},signal}, true);
      return result.url ? {url:result.url} : {refused:result.code ?? result.error ?? 'fetch_failed'};
    },
  };
}
