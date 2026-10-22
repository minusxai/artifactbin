import type { AfClient } from "../../../apollo/apollo-contracts.ts";
import type { DocumentNode } from "graphql";
import type {
  CompiledMutationIntent,
  CompiledMutationIntentStore,
} from "./dataset-mutations-contracts.ts";
class IntentConflict extends Error {}
/** A reserved viewer-local field in the same canonical Apollo document. No alternate browser store. */
export function compiledMutationIntentStore(
  client: Pick<AfClient, "watchQuery" | "updateQuery">,
  query: DocumentNode,
): CompiledMutationIntentStore {
  type Data = {
    datasetMutationIntents?: Record<string, CompiledMutationIntent>;
  };
  return {
    read() {
      let data: Data | undefined;
      const stop = client.watchQuery<Data>({ query }).subscribe((result) => {
        data = result.data;
      });
      stop.unsubscribe();
      return data?.datasetMutationIntents ?? {};
    },
    async compareAndSet(name, expectedRequestId, next) {
      try {
        await client.updateQuery<Data>(
          { query, requireDurable: true },
          (data) => {
            const intents = data.datasetMutationIntents ?? {};
            if (
              !intents ||
              typeof intents !== "object" ||
              Array.isArray(intents)
            )
              throw Error("Invalid stored mutation intents");
            const previous = Object.hasOwn(intents, name)
              ? intents[name]
              : undefined;
            if ((previous?.requestId ?? null) !== expectedRequestId)
              throw new IntentConflict();
            const updated = { ...intents };
            if (next)
              Object.defineProperty(updated, name, {
                value: next,
                enumerable: true,
                configurable: true,
                writable: true,
              });
            else delete updated[name];
            return { ...data, datasetMutationIntents: updated };
          },
        );
        return true;
      } catch (error) {
        if (error instanceof IntentConflict) return false;
        throw error;
      }
    },
  };
}
