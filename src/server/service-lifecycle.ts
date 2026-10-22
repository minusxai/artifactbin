import { createLiveInvalidationConsumer } from "../live-invalidation.ts";
import type { LiveInvalidationConsumer } from "../live-invalidation-contracts.ts";
import type {
  ServiceLifecycle,
  ServiceLifecycleOptions,
  ServiceInvalidationFactory,
} from "./service-lifecycle-contracts.ts";
/** Owns listener admission and the complete disposal barrier before persistence closes. */
export function createServiceLifecycle(
  options: ServiceLifecycleOptions,
  consume: ServiceInvalidationFactory = createLiveInvalidationConsumer,
): ServiceLifecycle {
  const consumers: LiveInvalidationConsumer[] = [];
  let closing: Promise<void> | undefined;
  const start = () => {
    if (closing) return;
    const readers = options.invalidationReaders.map((read) => read());
    for (const reader of readers)
      consumers.push(
        consume({ reader, changed: (id) => options.live.changedAndWait(id) }),
      );
  };
  options.server.once("listening", start);
  return {
    close() {
      if (closing) return closing;
      // Stop admission before yielding, so a late listening event cannot start work.
      options.server.off("listening", start);
      const dispose = [
        () => options.live.close(),
        () => options.runners.close(),
        () => options.backend?.close?.(),
        ...consumers.map((consumer) => () => consumer.close()),
        () => options.datasets.close(),
      ];
      // A synchronous throw or rejection must not skip another owned resource.
      closing = Promise.allSettled(
        dispose.map((close) => Promise.resolve().then(close)),
      ).then(async (results) => {
        const repository = await Promise.allSettled([
          Promise.resolve().then(() => options.repository.close()),
        ]);
        const failed = [...results, ...repository].find(
          (result) => result.status === "rejected",
        );
        if (failed?.status === "rejected") throw failed.reason;
      });
      return closing;
    },
  };
}
