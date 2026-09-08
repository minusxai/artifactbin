/**
 * The served document's QueryTransport when it IS the page: a plain GET of
 * its own query endpoint (`<queryUrl>?q=<JSON QueryRequest>`), which answers
 * with the anonymous read ACL and `Access-Control-Allow-Origin: *` — the
 * sandboxed document has an opaque origin and sends no cookie, and the route
 * never reads one, so this can only ever return what anyone could fetch.
 *
 * The relay (relay-transport.ts) stays the transport INSIDE a parent page:
 * the page holds the session a private document's queries need. The choice
 * is made once, by document-transport.ts. React-free.
 */
import { QUERY_REQUEST_PARAM } from './contract';
import type { QueryTransport } from './store';
import type { DataflowState, TableResult } from '@/lib/story/dataflow';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type QueryAnswer = Pick<DataflowState, 'tables' | 'errors' | 'mutationAccess'>;

export function createFetchTransport(queryUrl: string, fetchFn: FetchLike = (i, init) => fetch(i, init), mutateUrl?: string): QueryTransport {
  const ask = async (request: Record<string, unknown>): Promise<QueryAnswer> => {
    // A SIMPLE request on purpose — GET, no custom headers — so an opaque
    // origin needs no preflight; `credentials: 'omit'` states what the
    // sandbox already guarantees.
    const sep = queryUrl.includes('?') ? '&' : '?';
    const res = await fetchFn(`${queryUrl}${sep}${QUERY_REQUEST_PARAM}=${encodeURIComponent(JSON.stringify(request))}`, { method: 'GET', credentials: 'omit' });
    if (!res.ok) throw new Error(`query failed (${res.status})`);
    const body = (await res.json()) as Partial<QueryAnswer>;
    return { tables: body.tables ?? {}, errors: body.errors ?? {}, ...(body.mutationAccess ? {mutationAccess:body.mutationAccess} : {}) };
  };
  return {
    run: (values, only) => ask({ values, only }),
    page: async (values, name, page): Promise<TableResult> => {
      const r = await ask({ values, only: [name], page: { name, ...page } });
      const table = r.tables[name];
      if (!table) throw new Error(r.errors[name] ?? `no rows for "${name}"`);
      return table;
    },
    /*
     * The WRITE, when this document is the page: a POST of the mutation's NAME
     * and the reader's current values to the one write URL its CSP admits.
     *
     * `text/plain` deliberately — that keeps it a SIMPLE request, so an opaque
     * origin needs no preflight (the route parses the body as JSON either
     * way), and `credentials: 'omit'` states what the sandbox already
     * guarantees. A private document never gets here: its readers are served
     * the app shell and write through the relay.
     */
    ...(mutateUrl
      ? {
        mutate: async (values: Record<string, unknown>, name: string, row?: Record<string, unknown>) => {
          const res = await fetchFn(mutateUrl, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ mutation: name, values, ...(row ? { row } : {}) }),
          });
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; dataset?: string; error?: string; detail?: string };
          if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `write failed (${res.status})`);
          return { dataset: body.dataset ?? '' };
        },
      }
      : {}),
  };
}
