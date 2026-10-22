import type {
  CompiledDatasetBinding,
  CompiledDatasetColumn,
  DatasetReadLimits,
  DatasetReadRequest,
  DatasetReadBudget,
} from "./dataset-contracts.ts";
const defaults: DatasetReadLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxRows: 100_000,
  timeoutMs: 10_000,
  pageSize: 500,
};
const types = new Set(["string", "number", "boolean", "date", "timestamp"]);
export function validDatasetBinding(binding: CompiledDatasetBinding): boolean {
  if (
    !binding ||
    !Array.isArray(binding.tables) ||
    binding.tables.some(
      (t) =>
        !t ||
        !Array.isArray(t.columns) ||
        t.columns.some((c: unknown) => !c || typeof c !== "object"),
    )
  )
    return false;
  return (
    !!binding &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(binding.name) &&
    !["constructor", "prototype", "__proto__"].includes(binding.name) &&
    typeof binding.legacyRef === "string" &&
    binding.legacyRef.length > 0 &&
    binding.legacyRef.length <= 512 &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(binding.backendNamespace) &&
    !["constructor", "prototype", "__proto__"].includes(
      binding.backendNamespace,
    ) &&
    /^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(binding.backendHref) &&
    ["live", "pinned"].includes(binding.mode) &&
    Number.isSafeInteger(binding.version) &&
    binding.version > 0 &&
    Array.isArray(binding.tables) &&
    binding.tables.length > 0 &&
    binding.tables.length <= 64 &&
    new Set(binding.tables.map((t) => t.table)).size ===
      binding.tables.length &&
    binding.tables.every(
      (t) =>
        typeof t.schema === "string" &&
        t.schema.length > 0 &&
        t.schema.length <= 128 &&
        typeof t.table === "string" &&
        t.table.length > 0 &&
        t.table.length <= 128 &&
        !["constructor", "prototype", "__proto__"].includes(t.table) &&
        Array.isArray(t.columns) &&
        t.columns.length <= 256 &&
        new Set(t.columns.map((c: CompiledDatasetColumn) => c.name)).size ===
          t.columns.length &&
        t.columns.every(
          (c: CompiledDatasetColumn) =>
            typeof c.name === "string" &&
            c.name.length > 0 &&
            c.name.length <= 128 &&
            !["constructor", "prototype", "__proto__"].includes(c.name) &&
            types.has(c.type),
        ),
    )
  );
}
/** All-or-nothing: never evaluate SQL against a truncated or mixed-version dataset. */
export async function readCompiledDataset(
  binding: CompiledDatasetBinding,
  request: DatasetReadRequest,
  limits: Partial<DatasetReadLimits> = {},
  budget: DatasetReadBudget = { bytes: 0, rows: 0 },
): Promise<
  Record<
    string,
    {
      columns: CompiledDatasetBinding["tables"][number]["columns"];
      rows: Record<string, string | number | boolean | null>[];
    }
  >
> {
  const cap = { ...defaults, ...limits };
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      !validDatasetBinding(binding) ||
      Object.values(cap).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      !cap.timeoutMs ||
      !cap.pageSize
    )
      throw Error();
    const work = async () => {
      const result: Awaited<ReturnType<typeof readCompiledDataset>> =
        Object.create(null);
      let version: number | undefined, generation: number | undefined;
      for (const table of binding.tables) {
        const rows: Record<string, string | number | boolean | null>[] = [];
        let offset = 0,
          total: number | undefined;
        for (;;) {
          if (expired) throw Error();
          const window = await request(binding.backendNamespace, {
            binding: binding.name,
            schema: table.schema,
            table: table.table,
            offset,
            limit: cap.pageSize,
            ...(offset > 0
              ? { expectedVersion: version, expectedGeneration: generation }
              : {}),
          });
          if (
            !window ||
            !Number.isSafeInteger(window.version) ||
            window.version < 1 ||
            !Number.isSafeInteger(window.generation) ||
            window.generation < 0 ||
            (binding.mode === "pinned" && window.version !== binding.version) ||
            (version !== undefined && window.version !== version) ||
            (generation !== undefined && window.generation !== generation) ||
            window.schema !== table.schema ||
            window.table !== table.table ||
            window.offset !== offset ||
            !Number.isSafeInteger(window.totalRows) ||
            window.totalRows < 0 ||
            window.totalRows > cap.maxRows ||
            (total !== undefined && total !== window.totalRows) ||
            !Array.isArray(window.columns) ||
            window.columns.length !== table.columns.length ||
            window.columns.some(
              (c, i) =>
                !c ||
                c.name !== table.columns[i]?.name ||
                c.type !== table.columns[i]?.type,
            ) ||
            !Array.isArray(window.rows)
          )
            throw Error();
          if (expired) throw Error();
          version = window.version;
          generation = window.generation;
          total = window.totalRows;
          budget.bytes += new TextEncoder().encode(
            JSON.stringify(window),
          ).byteLength;
          budget.rows += window.rows.length;
          if (
            budget.bytes > cap.maxBytes ||
            budget.rows > cap.maxRows ||
            rows.length + window.rows.length > total ||
            window.rows.length > cap.pageSize
          )
            throw Error();
          for (const row of window.rows) {
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
          }
          rows.push(...window.rows);
          if (window.nextOffset === null) {
            if (rows.length !== total) throw Error();
            break;
          }
          if (
            !Number.isSafeInteger(window.nextOffset) ||
            window.nextOffset !== rows.length ||
            window.nextOffset <= offset ||
            window.nextOffset >= total
          )
            throw Error();
          offset = window.nextOffset;
        }
        result[table.table] = { columns: table.columns, rows };
      }
      return result;
    };
    return await Promise.race([
      (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await work();
          } catch (error) {
            if (expired || binding.mode !== "live" || attempt >= 1) throw error;
          }
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(Error());
        }, cap.timeoutMs);
      }),
    ]);
  } catch {
    throw Error("Dataset read unavailable");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
