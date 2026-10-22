import {
  DatasetReadError,
  DATASET_RESULT_BYTES,
  type DatasetReadPorts,
  type DatasetReadService,
  type DatasetReadRequest,
  type DatasetBinding,
  type DatasetReadAuthority,
  type DatasetCallContext,
  type DatasetReadResult,
} from "./contracts.ts";
import { datasetReadable } from "./policy/read.ts";
import { readRows, validateTable } from "./rows.ts";
function requestOf(value: unknown): DatasetReadRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DatasetReadError("invalid_request");
  const r = value as Record<string, unknown>;
  if (
    ["binding", "schema", "table", "offset", "limit"].some(
      (k) => !Object.hasOwn(r, k),
    ) ||
    Object.keys(r).some(
      (k) => !["binding", "schema", "table", "offset", "limit"].includes(k),
    ) ||
    ["binding", "schema", "table"].some(
      (k) => typeof r[k] !== "string" || !r[k] || String(r[k]).length > 128,
    ) ||
    !Number.isSafeInteger(r.offset) ||
    Number(r.offset) < 0 ||
    !Number.isSafeInteger(r.limit) ||
    Number(r.limit) < 1 ||
    Number(r.limit) > 10000
  )
    throw new DatasetReadError("invalid_request");
  return r as unknown as DatasetReadRequest;
}
function authorized(
  context: DatasetCallContext,
  b: DatasetBinding,
  a: DatasetReadAuthority | null,
): boolean {
  return (
    !!a &&
    b.backendId === context.backendId &&
    b.backendVersion === context.backendVersion &&
    b.page.id === context.pageId &&
    a.pageVersion === b.page.version &&
    a.page.id === b.page.legacyId &&
    a.page.editId === b.page.editId &&
    a.dataset.id === b.dataset.id &&
    a.dataset.policyRevision === b.dataset.policyRevision &&
    (context.subject !== null ||
      (!a.facts.caller.userId &&
        !a.facts.caller.tokenId &&
        !a.facts.caller.groupId)) &&
    datasetReadable(a)
  );
}
export function createDatasetReadService(
  ports: DatasetReadPorts,
): DatasetReadService {
  return {
    async read(context, value, signal) {
      signal?.throwIfAborted();
      const r = requestOf(value);
      const found = await ports.binding(context, r.binding);
      const b = found ? structuredClone(found) : null;
      if (
        !b ||
        b.name !== r.binding ||
        b.backendId !== context.backendId ||
        b.backendVersion !== context.backendVersion ||
        b.page.id !== context.pageId ||
        !Number.isSafeInteger(b.dataset.version) ||
        b.dataset.version < 1
      )
        throw new DatasetReadError("denied");
      const matches = b.tables.filter(
        (t) => t.schema === r.schema && t.name === r.table,
      );
      if (matches.length !== 1) throw new DatasetReadError("denied");
      const table = matches[0]!;
      validateTable(table);
      if (!authorized(context, b, await ports.authority(context, b)))
        throw new DatasetReadError("denied");
      const rows = await readRows(
        table,
        await ports.read(table.object.key, signal),
        signal,
      );
      if (!authorized(context, b, await ports.authority(context, b)))
        throw new DatasetReadError("denied");
      signal?.throwIfAborted();
      const result: DatasetReadResult = {
        version: b.dataset.version,
        schema: r.schema,
        table: r.table,
        columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
        rows: [],
        offset: r.offset,
        nextOffset: null,
        totalRows: rows.length,
      };
      const end = Math.min(rows.length, r.offset + r.limit);
      for (let i = r.offset; i < end; i++) {
        result.rows.push(rows[i]!);
        result.nextOffset = i + 1 < rows.length ? i + 1 : null;
        if (Buffer.byteLength(JSON.stringify(result)) > DATASET_RESULT_BYTES) {
          result.rows.pop();
          result.nextOffset = i;
          if (!result.rows.length) throw new DatasetReadError("result_limit");
          break;
        }
      }
      if (Buffer.byteLength(JSON.stringify(result)) > DATASET_RESULT_BYTES)
        throw new DatasetReadError("result_limit");
      return result;
    },
  };
}
