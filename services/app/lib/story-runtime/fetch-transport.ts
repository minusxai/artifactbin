/**
 * The served document's QueryTransport when it IS the page: normally a plain
 * GET of its own query endpoint (`<queryUrl>?q=<JSON QueryRequest>`), which answers
 * with the anonymous read ACL and `Access-Control-Allow-Origin: *` — the
 * sandboxed document has an opaque origin and sends no cookie, and the route
 * never reads one, so this can only ever return what anyone could fetch.
 *
 * SESSION MODE (`{ session: true }`): a compiled reader page served to a
 * SIGNED-IN reader (lib/islands/boot, the page's signed-in hint). Its answers
 * and writes are the reader's, so every request goes to the POST doors with
 * `credentials: 'same-origin'` — the doors that read the session, exactly as
 * the app's own authenticated transport does. A guest page keeps the
 * anonymous GET above, unchanged.
 *
 * The relay (relay-transport.ts) stays the transport INSIDE a parent page:
 * the page holds the session a private document's queries need. The choice
 * is made once, by document-transport.ts. framework-free.
 */
import { QUERY_REQUEST_PARAM } from './contract';
import type { QueryTransport } from './store';
import type { DataflowState, TableResult } from '@/lib/story/data/dataflow';
import { localZone } from '@/lib/story/data/builtins';
import type { ImportTables } from '@/lib/story/data/compiled-flow';
import type { PersonCard } from '@artifactbin/contracts';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type QueryAnswer = Pick<DataflowState, 'tables' | 'errors' | 'mutationAccess' | 'userOptions' | 'people'>;

export interface FetchTransportOptions {
  /** The page is signed in: every request goes to the session-reading POST doors with the session (see above). */
  session?: boolean;
}

export function createFetchTransport(queryUrl: string, fetchFn: FetchLike = (i, init) => fetch(i, init), mutateUrl?: string, options: FetchTransportOptions = {}): QueryTransport {
  const session = !!options.session;
  const credentials: RequestCredentials = session ? 'same-origin' : 'omit';
  const post = (url: string, body: unknown) => fetchFn(url, { method: 'POST', credentials, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const ask = async (request: Record<string, unknown>): Promise<QueryAnswer> => {
    const localTables = request.localTables;
    const carriesLocalTables = !!localTables && typeof localTables === 'object' && Object.keys(localTables).length > 0;
    // Local table snapshots can be large, so they use a simple text/plain
    // POST rather than a bounded URL. Ordinary queries remain GETs — except
    // with the session, which only the POST door reads.
    const sep = queryUrl.includes('?') ? '&' : '?';
    const res = carriesLocalTables || session
      ? await post(queryUrl, request)
      : await fetchFn(`${queryUrl}${sep}${QUERY_REQUEST_PARAM}=${encodeURIComponent(JSON.stringify(request))}`, { method: 'GET', credentials: 'omit' });
    if (!res.ok) throw new Error(`query failed (${res.status})`);
    const body = (await res.json()) as Partial<QueryAnswer>;
    return {userOptions:body.userOptions,people:body.people, tables: body.tables ?? {}, errors: body.errors ?? {}, ...(body.mutationAccess ? {mutationAccess:body.mutationAccess} : {}) };
  };
  return {
    run: (values, only, localTables) => ask({ values, only, tz: localZone(), ...(localTables ? { localTables } : {}) }),
    /*
     * ONE scoped POST per held dataset, with or without the session: a dataset's rows are no URL's
     * business (a GET puts the request in every log and cache on the way), and the POST door answers a
     * credential-free request exactly as the GET door does — the anonymous read, CORS `*` — so a
     * sandboxed copy's opaque origin can ask it too (`text/plain` keeps it a simple request).
     */
    hold: async (name) => {
      const res = await post(queryUrl, { hold: name });
      if (!res.ok) throw new Error(`hold failed (${res.status})`);
      return ((await res.json()) as { tables: ImportTables[string] }).tables;
    },
    // A POST like a large local-table run: a batch of ids would outgrow a URL. `text/plain` keeps it a simple request.
    people: async (ids) => {
      const res = await post(queryUrl, { people: ids });
      if (!res.ok) throw new Error(`people failed (${res.status})`);
      return ((await res.json()) as { people: Record<string, PersonCard> }).people;
    },
    page: async (values, name, page, localTables): Promise<TableResult> => {
      const r = await ask({ values, only: [name], page: { name, ...page }, tz: localZone(), ...(localTables ? { localTables } : {}) });
      const table = r.tables[name];
      if (!table) throw new Error(r.errors[name] ?? `no rows for "${name}"`);
      return table;
    },
    /*
     * The WRITE, when this document is the page: a POST of the mutation request
     * (lib/story/datasets/mutation-request) to the one write URL its CSP admits.
     * With the session (a signed-in page), it carries it: the write is the reader's.
     *
     * `text/plain` deliberately — that keeps it a SIMPLE request, so an opaque
     * origin needs no preflight (the route parses the body as JSON either
     * way), and `credentials: 'omit'` states what the sandbox already
     * guarantees. A private document never gets here: its readers are served
     * the app shell and write through the relay.
     */
    ...(mutateUrl
      ? {
        mutate: async (request: import('@/lib/story/datasets/mutation-request').MutationRequest) => {
          const res = await post(mutateUrl, { tz: localZone(), ...request });
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; dataset?: string; mutationRunId?:string; local?: import('@/lib/story/datasets/local-state').LocalMutationResult; error?: string; detail?: string };
          if (!res.ok || !body.ok) throw new Error(body.detail ?? body.error ?? `write failed (${res.status})`);
          return { dataset: body.dataset ?? '', local: body.local, mutationRunId: body.mutationRunId };
        },
      }
      : {}),
  };
}
