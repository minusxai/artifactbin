/** The self-contained, DOM-free runtime shipped as lambda-page-runtime.js beside a server bundle. */
import { createRoot } from 'solid-js';
import { bindPage, createDataflowStore, type MutationAnswer, type RunAnswer } from '@/lib/story-runtime/data';
import type { CompiledDataflow } from '@/lib/dataflow/compiled-dataflow';

// The author and bindings MUST use this same Solid graph, never a second bundled instance.
export { batch, createEffect, createMemo, createRoot, createSignal, on, onCleanup, onMount, untrack } from 'solid-js';

interface LambdaContext { artifactbin: { call(operation: string, args: unknown): Promise<unknown> } }
export function createLambdaPage(flow: CompiledDataflow, context: LambdaContext) {
  let operation = 0;
  const pending = new Set<Promise<unknown>>();
  const track = <T>(request: Promise<T>): Promise<T> => {
    pending.add(request);
    // Both handlers handle the bookkeeping promise, even when the caller handles the original rejection.
    request.then(() => pending.delete(request), () => pending.delete(request));
    return request;
  };
  const store = createDataflowStore({ flow }, {
    // The authenticated host generates the durable idempotency key from run + RPC id.
    operationId: () => `lambda-operation-${++operation}`,
    transport: {
      run: (values, only, localTables) => track(context.artifactbin.call('lambda_query', { values, only, ...(localTables ? { localTables } : {}) }) as Promise<RunAnswer>),
      mutate: (request) => track(context.artifactbin.call('lambda_mutate', request) as Promise<MutationAnswer>),
      page: () => Promise.reject(new Error('Lambda page bindings do not paginate; declare the required query')),
    },
  });
  const bindings = bindPage(store);
  let stopAuthor: (() => void) | undefined;
  return {
    bindings,
    start: () => store.start(),
    /** Module evaluation gets an owner for Solid effects; it happens only after bindings exist. */
    evaluate: <T>(load: () => T): T => createRoot((dispose) => { stopAuthor = dispose; return load(); }),
    /** Finish initial reads and writes already issued before producing the receipt. */
    async drain() { while (pending.size) await Promise.allSettled([...pending]); },
    dispose() { stopAuthor?.(); bindings.dispose(); store.dispose(); },
  };
}
