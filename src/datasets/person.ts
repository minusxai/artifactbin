import { DatasetReadError } from "./contracts.ts";
import type {
  DatasetPersonPorts,
  DatasetPersonService,
} from "./person-contracts.ts";
const denied = (): never => {
  throw new DatasetReadError("denied");
};
/** A requested ID only narrows an exact registered, policy-filtered user column. */
export function createDatasetPersonService(
  ports: DatasetPersonPorts,
): DatasetPersonService {
  return {
    async person(context, input, callerSignal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      callerSignal?.addEventListener("abort", abort, { once: true });
      if (callerSignal?.aborted) abort();
      const timer = setTimeout(abort, 5000);
      const signal = controller.signal;
      const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
        signal.throwIfAborted();
        return await new Promise<T>((resolve, reject) => {
          const interrupted = () => reject(signal.reason);
          signal.addEventListener("abort", interrupted, { once: true });
          operation().then(
            (value) => {
              signal.removeEventListener("abort", interrupted);
              if (signal.aborted) reject(signal.reason);
              else resolve(value);
            },
            (error) => {
              signal.removeEventListener("abort", interrupted);
              reject(error);
            },
          );
        });
      };
      try {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).sort().join() !== "userId,valueName"
        )
          throw new DatasetReadError("invalid_request");
        const { valueName, userId } = input as Record<string, unknown>;
        if (
          typeof valueName !== "string" ||
          !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(valueName) ||
          typeof userId !== "string" ||
          !userId ||
          new TextEncoder().encode(userId).length > 16384
        )
          throw new DatasetReadError("invalid_request");
        const binding = await wait(() =>
          ports.binding(context, valueName, signal),
        );
        if (!binding) return denied();
        if (
          binding.backendId !== context.backendId ||
          binding.backendVersion !== context.backendVersion ||
          binding.pageId !== context.pageId ||
          binding.valueName !== valueName
        )
          return denied();
        let offset = 0,
          version: number | undefined,
          generation: number | undefined,
          foundOffset: number | undefined;
        for (let page = 0; page < 16; page++) {
          const result = await wait(() =>
            ports.reads.read(
              context,
              {
                binding: binding.bindingName,
                schema: binding.schema,
                table: binding.table,
                offset,
                limit: 1000,
                ...(version === undefined
                  ? {}
                  : {
                      expectedVersion: version,
                      expectedGeneration: generation,
                    }),
              },
              signal,
            ),
          );
          if (
            !result.columns.some(
              (c) => c.name === binding.column && c.type === "user",
            )
          )
            return denied();
          if (
            version !== undefined &&
            (version !== result.version || generation !== result.generation)
          )
            throw new DatasetReadError("dataset_changed");
          version = result.version;
          generation = result.generation;
          if (result.rows.some((row) => row[binding.column] === userId)) {
            foundOffset = offset;
            break;
          }
          if (result.nextOffset === null) return null;
          if (
            !Number.isSafeInteger(result.nextOffset) ||
            result.nextOffset <= offset
          )
            throw new DatasetReadError("invalid_dataset");
          offset = result.nextOffset;
        }
        if (foundOffset === undefined)
          throw new DatasetReadError("result_limit");
        const card = await wait(() =>
          ports.card(binding.sourceNamespace, userId, signal),
        );
        const freshBinding = await wait(() =>
          ports.binding(context, valueName, signal),
        );
        if (
          !freshBinding ||
          JSON.stringify(freshBinding) !== JSON.stringify(binding)
        )
          return denied();
        const fresh = await wait(() =>
          ports.reads.read(
            context,
            {
              binding: binding.bindingName,
              schema: binding.schema,
              table: binding.table,
              offset: foundOffset,
              limit: 1000,
              expectedVersion: version,
              expectedGeneration: generation,
            },
            signal,
          ),
        );
        if (fresh.version !== version || fresh.generation !== generation)
          throw new DatasetReadError("dataset_changed");
        if (!fresh.rows.some((row) => row[binding.column] === userId))
          return denied();
        if (
          card &&
          (Object.keys(card).sort().join() !== "handle,image,name" ||
            typeof card.name !== "string" ||
            card.name.length > 4096 ||
            (typeof card.handle === "string" && card.handle.length > 4096) ||
            (typeof card.image === "string" &&
              !/^[a-f0-9]{64}$/.test(card.image)) ||
            !card.name ||
            (card.handle !== null && typeof card.handle !== "string") ||
            (card.image !== null && typeof card.image !== "string"))
        )
          throw new DatasetReadError("invalid_dataset");
        return card
          ? {
              name: card.name,
              handle: card.handle,
              image:
                card.image === null
                  ? null
                  : `/af/v1/ids/${binding.pageId}/person-images/${binding.valueName}/${card.image}`,
            }
          : null;
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", abort);
      }
    },
  };
}
