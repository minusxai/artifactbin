import type {
  CompiledDatasetBinding,
  DatasetReadWindow,
} from "../conversion/compiled/dataset-contracts.ts";
import type {
  DatasetPageReader,
  DatasetPageReaderOptions,
  DatasetPageReadPort,
} from "./contracts.ts";
/** Closure-free so the same checked window protocol can be embedded in ordinary HTML. */
export function createDatasetPageReader(
  binding: CompiledDatasetBinding,
  request: DatasetPageReadPort,
  options: DatasetPageReaderOptions = {},
): DatasetPageReader {
  const pageSize = options.pageSize ?? 100,
    maxBytes = options.maxBytes ?? 1024 * 1024,
    timeoutMs = options.timeoutMs ?? 10000;
  if (
    ![pageSize, maxBytes, timeoutMs].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    pageSize > 1000 ||
    maxBytes > 1024 * 1024 ||
    timeoutMs > 10000
  )
    throw Error("Invalid dataset page limits");
  return {
    async read(tableIndex, offset = 0, previous) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const table = binding.tables[tableIndex];
        if (
          !Number.isSafeInteger(tableIndex) ||
          !table ||
          !Number.isSafeInteger(offset) ||
          offset < 0
        )
          throw Error();
        if (
          offset > 0 &&
          (!previous ||
            previous.schema !== table.schema ||
            previous.table !== table.table ||
            previous.nextOffset !== offset)
        )
          throw Error();
        const args = {
          binding: binding.name,
          schema: table.schema,
          table: table.table,
          offset,
          limit: pageSize,
          ...(offset > 0
            ? {
                expectedVersion: previous!.version,
                expectedGeneration: previous!.generation,
              }
            : {}),
        };
        const result: DatasetReadWindow = await Promise.race([
          request(binding.backendNamespace, args),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error()), timeoutMs);
          }),
        ]);
        if (
          !result ||
          !Number.isSafeInteger(result.version) ||
          result.version < 1 ||
          !Number.isSafeInteger(result.generation) ||
          result.generation < 0 ||
          result.schema !== table.schema ||
          result.table !== table.table ||
          result.offset !== offset ||
          !Number.isSafeInteger(result.totalRows) ||
          result.totalRows < offset ||
          !Array.isArray(result.columns) ||
          result.columns.length !== table.columns.length ||
          result.columns.some(
            (c, i) =>
              !c ||
              c.name !== table.columns[i]?.name ||
              c.type !== table.columns[i]?.type,
          ) ||
          !Array.isArray(result.rows) ||
          result.rows.length > pageSize ||
          offset + result.rows.length > result.totalRows ||
          new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes
        )
          throw Error();
        if (binding.mode === "pinned" && result.version !== binding.version)
          throw Error();
        if (
          offset > 0 &&
          (result.version !== previous!.version ||
            result.generation !== previous!.generation ||
            result.totalRows !== previous!.totalRows)
        )
          throw Error();
        for (const row of result.rows)
          if (
            !row ||
            typeof row !== "object" ||
            Array.isArray(row) ||
            Object.keys(row).length !== table.columns.length ||
            table.columns.some(
              (c) =>
                !Object.hasOwn(row, c.name) ||
                !(
                  row[c.name] === null ||
                  (c.type === "number"
                    ? typeof row[c.name] === "number" &&
                      Number.isFinite(row[c.name])
                    : c.type === "boolean"
                      ? typeof row[c.name] === "boolean"
                      : typeof row[c.name] === "string")
                ),
            )
          )
            throw Error();
        const end = offset + result.rows.length;
        if (
          result.nextOffset === null
            ? end !== result.totalRows
            : !Number.isSafeInteger(result.nextOffset) ||
              result.nextOffset !== end ||
              end <= offset ||
              end >= result.totalRows
        )
          throw Error();
        return result;
      } catch {
        throw Error("Dataset read unavailable");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
