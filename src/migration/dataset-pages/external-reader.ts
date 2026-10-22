import type {
  DatasetPageReaderOptions,
  ExternalDatasetPageReadPort,
  ExternalDatasetPageWindow,
  RegisteredExternalDatasetPageSource,
} from "./contracts.ts";
/** One exact registered result window; remote rows have no stored generation or known total. */
export function createExternalDatasetPageReader(
  source: RegisteredExternalDatasetPageSource,
  request: ExternalDatasetPageReadPort,
  options: DatasetPageReaderOptions = {},
) {
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
    async read(
      tableIndex: number,
      offset = 0,
    ): Promise<ExternalDatasetPageWindow> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const table = source.tables[tableIndex];
        if (
          !Number.isSafeInteger(tableIndex) ||
          !table ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > 1000000
        )
          throw Error();
        const raw = await Promise.race([
          request({
            name: table.queryName,
            valuesJson: "{}",
            offset,
            limit: pageSize,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error()), timeoutMs);
          }),
        ]);
        if (
          !raw ||
          typeof raw !== "object" ||
          Array.isArray(raw) ||
          new TextEncoder().encode(JSON.stringify(raw)).byteLength > maxBytes
        )
          throw Error();
        const result = raw as {
          columns?: { name: string; type: string }[];
          rows?: Record<string, string | number | boolean | null>[];
          truncated?: boolean;
        };
        if (
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
          (result.truncated !== undefined &&
            typeof result.truncated !== "boolean") ||
          (result.truncated && result.rows.length === 0)
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
        return {
          columns: result.columns,
          rows: result.rows,
          offset,
          nextOffset: result.truncated ? offset + result.rows.length : null,
        };
      } catch {
        throw Error("Dataset read unavailable");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
