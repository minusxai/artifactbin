/**
 * THE LINK FOLLOWS THE READER — the document's half of F2.
 *
 * A dashboard is only shareable if the address bar says what the reader
 * narrowed it to. This subscribes the document's store and, when a `<Value>`
 * actually moves, says so — to exactly one of two places, chosen by whether
 * this document is framed:
 *
 *  - TOP-LEVEL (the reader's own document): through `__mxValues`, the single
 *    narrow capability the frozen history prelude leaves open. It takes the
 *    `$` params and nothing else — no path, no host, no hash — so there is no
 *    address to smuggle in;
 *  - FRAMED (the owner's shell, the editor, a capture): up the signed pristine
 *    channel, because the `location` a framed document can reach is the
 *    FRAME's. Writing there moves `/a/<id>/raw?edit=1`, which nobody can see
 *    or copy — measured on the spike, and the whole reason `mx:values` exists.
 *    The page then re-derives the address from the flow IT holds.
 *
 * Two rules, both about not being noisy: the write is DEBOUNCED (a slider is a
 * burst, not a decision), and it is COMPARED against what was last said — a
 * store notifies for things that are not a value change at all (rows landing,
 * a query going busy), and an address rewritten on each of those is churn a
 * reader can see in their own back button.
 */
import type { Dataflow, Scalar } from '@/lib/story/dataflow';
import { urlValueParams } from '@/lib/story/url-values';
import type { DataflowStore } from './store';

/** Where a change is reported. Exactly one is used; `post` wins when present. */
export interface ValuesUrlSink {
  /**
   * The top-level document's own URL capability — `window.__mxValues`
   * (STORY_VALUES_HOOK), which takes `{name: string | null}`: a string sets
   * `$name`, null removes it.
   */
  hook?: ((params: Record<string, string | null>) => void) | null;
  /**
   * The framed document's report to its page: every declared scalar at its
   * current value. Present means FRAMED, and then the hook is never used.
   */
  post?: ((values: Record<string, Scalar>) => void) | null;
}

/** ~150ms: long enough to swallow a drag, short enough that a click feels answered. */
export const VALUES_URL_DEBOUNCE_MS = 150;

/** The declared scalars of `flow`, at the values `state` holds. */
function scalarsAt(flow: Dataflow, values: Record<string, Scalar>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const v of flow.values) if (v.kind === 'scalar' && v.name in values) out[v.name] = values[v.name];
  return out;
}

/**
 * Wire the store to the link. Returns the teardown.
 *
 * The baseline is the store's CURRENT state, which is the state the link
 * already describes (the server seeded it from that link) — so nothing is
 * written until a reader actually changes something.
 */
export function syncValuesToUrl(
  store: Pick<DataflowStore, 'subscribe' | 'getState'>,
  /*
   * ASKED FOR, not captured: an agent's write replaces the declarations under
   * a document that is still open (`store.replaceFlow`), and a Value that
   * version no longer declares must stop appearing in the link.
   */
  flowOf: () => Dataflow,
  sink: ValuesUrlSink,
  debounceMs: number = VALUES_URL_DEBOUNCE_MS,
): () => void {
  const paramsNow = (): Record<string, string | null> => urlValueParams(flowOf(), store.getState().values);
  let last = JSON.stringify(paramsNow());
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const params = paramsNow();
    const next = JSON.stringify(params);
    if (next === last) return;
    last = next;
    if (sink.post) sink.post(scalarsAt(flowOf(), store.getState().values));
    else sink.hook?.(params);
  };

  const stop = store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}
