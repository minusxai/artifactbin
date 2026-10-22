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
    async person(context, input) {
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
      const binding = await ports.binding(context, valueName);
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
      for (let page = 0; page < 10000; page++) {
        const result = await ports.reads.read(context, {
          binding: binding.bindingName,
          schema: binding.schema,
          table: binding.table,
          offset,
          limit: 1000,
          ...(version === undefined
            ? {}
            : { expectedVersion: version, expectedGeneration: generation }),
        });
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
      if (foundOffset === undefined) throw new DatasetReadError("result_limit");
      const card = await ports.card(binding.sourceNamespace, userId);
      const freshBinding = await ports.binding(context, valueName);
      if (
        !freshBinding ||
        JSON.stringify(freshBinding) !== JSON.stringify(binding)
      )
        return denied();
      const fresh = await ports.reads.read(context, {
        binding: binding.bindingName,
        schema: binding.schema,
        table: binding.table,
        offset: foundOffset,
        limit: 1000,
        expectedVersion: version,
        expectedGeneration: generation,
      });
      if (fresh.version !== version || fresh.generation !== generation)
        throw new DatasetReadError("dataset_changed");
      if (!fresh.rows.some((row) => row[binding.column] === userId))
        return denied();
      if (
        card &&
        (typeof card.name !== "string" ||
          !card.name ||
          (card.handle !== null && typeof card.handle !== "string") ||
          (card.image !== null && typeof card.image !== "string"))
      )
        throw new DatasetReadError("invalid_dataset");
      return card ? structuredClone(card) : null;
    },
  };
}
