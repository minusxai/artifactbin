/**
 * The served document's QueryTransport INSIDE A PARENT: a postMessage relay
 * to the page (lib/story-runtime/contract.ts STORY_QUERY_MESSAGE). The page
 * has the session a private document's queries need — so there, every re-run
 * crosses this boundary. (Top-level the document fetches for itself:
 * fetch-transport.ts; the choice is document-transport.ts.)
 * Requests are matched by id, addressed to the app's own origin and accepted
 * only from the parent window AT that origin — a query request carries the
 * document's parameters, and its answer BECOMES the numbers a reader sees, so
 * a framer able to forge one would not break the document, it would make it
 * lie. Requests are matched by id,
 * and an unanswered request rejects after `timeoutMs` (the store then reports
 * the message on the affected queries rather than spinning forever).
 * React-free; installed by the entry.
 */
import {
  STORY_ASSET_MESSAGE, STORY_ASSET_RESULT_MESSAGE,
  STORY_MUTATE_MESSAGE, STORY_MUTATE_RESULT_MESSAGE, STORY_QUERY_MESSAGE, STORY_QUERY_RESULT_MESSAGE,
  type StoryAssetRequest, type StoryAssetResult,
  type StoryMutateRequest, type StoryMutateResult, type StoryQueryRequest, type StoryQueryResult,
} from './contract';
import type { QueryTransport } from './store';

export function createRelayTransport(target: Window, appOrigin: string, source: Window = window, timeoutMs = 20_000): QueryTransport {
  let seq = 0;
  // `clear` rather than a bare timer handle: a request owns its timeout AND its
  // retries, and every path that finishes it has to drop all of them.
  const waiting = new Map<number, { resolve: (r: Extract<StoryQueryResult, { tables: unknown }>) => void; reject: (e: Error) => void; clear: () => void }>();
  source.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== target || e.origin !== appOrigin) return;
    const data = e.data as StoryQueryResult | undefined;
    if (!data || typeof data !== 'object' || data.type !== STORY_QUERY_RESULT_MESSAGE) return;
    const w = waiting.get(data.id);
    if (!w) return;
    waiting.delete(data.id);
    w.clear();
    if ('error' in data) w.reject(new Error(data.error));
    else w.resolve(data);
  });
  /*
   * A postMessage nobody is listening for yet is not queued — it is GONE, and
   * with one send per request that meant waiting out the timeout with empty
   * charts. It is a real race: the document asks for its rows the moment it
   * has a channel, and the page installs its listener in an effect, so which
   * happens first is not ours to decide. So an unanswered request is re-posted
   * a couple of times before the timeout has its say. Re-posting is safe
   * because the ID is the same: a page that heard the first one answers once,
   * and a second answer for an id already resolved is dropped by the waiter
   * lookup above.
   */
  const RETRIES_AT = [400, 1200];
  const send = (req: Omit<StoryQueryRequest, 'type' | 'id'>) => new Promise<Extract<StoryQueryResult, { tables: unknown }>>((resolve, reject) => {
    const id = ++seq;
    const post = () => target.postMessage({ type: STORY_QUERY_MESSAGE, id, ...req } satisfies StoryQueryRequest, appOrigin);
    const timers = [
      ...RETRIES_AT.map((at) => setTimeout(() => { if (waiting.has(id)) post(); }, at)),
      setTimeout(() => { waiting.delete(id); reject(new Error('the page did not answer the query')); }, timeoutMs),
    ];
    waiting.set(id, { resolve, reject, clear: () => { for (const t of timers) clearTimeout(t); } });
    post();
  });

  /**
   * The WRITE half of the relay. Same envelope, same origin scoping, its own
   * message type and waiter map — a write must never be answered by a query's
   * reply, and vice versa.
   */
  let writeSeq = 0;
  const writers = new Map<number, { resolve: (r: { dataset: string }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  source.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== target || e.origin !== appOrigin) return;
    const data = e.data as StoryMutateResult | undefined;
    if (!data || typeof data !== 'object' || data.type !== STORY_MUTATE_RESULT_MESSAGE) return;
    const w = writers.get(data.id);
    if (!w) return;
    writers.delete(data.id);
    clearTimeout(w.timer);
    if (data.ok) w.resolve({ dataset: data.dataset });
    else w.reject(new Error(data.error));
  });

  /**
   * The ASSET half. Its own message type and waiter map, for the reason the
   * write half has its own: an import must never be answered by a query's
   * reply, and vice versa.
   *
   * It RESOLVES rather than rejects, always — `{refused}` is an answer, and a
   * silence is `refused: 'no_answer'`. A bound image has exactly one way to
   * report anything (its alt text, under `data-mx-asset="refused"`), so a
   * rejection here would only become an unhandled promise and an empty box.
   */
  let assetSeq = 0;
  const importers = new Map<number, { settle: (r: { url: string } | { refused: string }) => void; clear: () => void }>();
  source.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== target || e.origin !== appOrigin) return;
    const data = e.data as StoryAssetResult | undefined;
    if (!data || typeof data !== 'object' || data.type !== STORY_ASSET_RESULT_MESSAGE) return;
    const w = importers.get(data.id);
    if (!w) return;
    importers.delete(data.id);
    w.clear();
    w.settle('url' in data ? { url: data.url } : { refused: data.refused });
  });

  return {
    importAsset: (url) => new Promise<{ url: string } | { refused: string }>((settle) => {
      const id = ++assetSeq;
      const post = () => target.postMessage({ type: STORY_ASSET_MESSAGE, id, url } satisfies StoryAssetRequest, appOrigin);
      /*
       * Re-posted on the SAME schedule as a query, and for the same reason: a
       * message nobody is listening for yet is not queued anywhere, it is gone.
       * The page installs its listener in an effect while the frame asks the
       * moment it has a channel — and in an EXPORT the two start together, so
       * one send meant a private document's og image photographed its alt text.
       * Re-posting is safe because the id does not change: a page that heard
       * the first one answers once, and the second answer for a settled id is
       * dropped by the waiter lookup above.
       */
      const timers = [
        ...RETRIES_AT.map((at) => setTimeout(() => { if (importers.has(id)) post(); }, at)),
        setTimeout(() => { importers.delete(id); settle({ refused: 'no_answer' }); }, timeoutMs),
      ];
      importers.set(id, { settle, clear: () => { for (const t of timers) clearTimeout(t); } });
      post();
    }),
    run: async (values, only) => {
      const r = await send({ values, only });
      return { tables: r.tables, errors: r.errors };
    },
    mutate: (values, mutation) => new Promise<{ dataset: string }>((resolve, reject) => {
      const id = ++writeSeq;
      const timer = setTimeout(() => { writers.delete(id); reject(new Error('the page did not answer the write')); }, timeoutMs);
      writers.set(id, { resolve, reject, timer });
      target.postMessage({ type: STORY_MUTATE_MESSAGE, id, mutation, values } satisfies StoryMutateRequest, appOrigin);
    }),
    page: async (values, name, page) => {
      const r = await send({ values, only: [name], page: { name, ...page } });
      const table = r.tables[name];
      if (!table) throw new Error(r.errors[name] ?? `no rows for "${name}"`);
      return table;
    },
  };
}
