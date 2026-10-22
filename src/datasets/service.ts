import {
  DatasetReadError,
  DATASET_RESULT_BYTES,
  type DatasetReadPorts,
  type DatasetReadService,
  type DatasetReadRequest,
  type DatasetResolvedBinding,
  type DatasetReadAuthority,
  type DatasetCallContext,
  type DatasetReadResult,
} from "./contracts.ts";
import { datasetReadable } from "./policy/read.ts";
import { readRows, validateTable, projectRow } from "./rows.ts";
function requestOf(value: unknown): DatasetReadRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DatasetReadError("invalid_request");
  const r = value as Record<string, unknown>;
  if (
    ["binding", "schema", "table", "offset", "limit"].some(
      (k) => !Object.hasOwn(r, k),
    ) ||
    Object.keys(r).some(
      (k) =>
        ![
          "binding",
          "schema",
          "table",
          "offset",
          "limit",
          "expectedVersion",
          "expectedGeneration",
        ].includes(k),
    ) ||
    ["binding", "schema", "table"].some(
      (k) => typeof r[k] !== "string" || !r[k] || String(r[k]).length > 128,
    ) ||
    !Number.isSafeInteger(r.offset) ||
    Number(r.offset) < 0 ||
    !Number.isSafeInteger(r.limit) ||
    Number(r.limit) < 1 ||
    Number(r.limit) > 10000 ||
    (r.expectedVersion === undefined) !==
      (r.expectedGeneration === undefined) ||
    (r.expectedVersion !== undefined &&
      (!Number.isSafeInteger(r.expectedVersion) ||
        Number(r.expectedVersion) < 1 ||
        !Number.isSafeInteger(r.expectedGeneration) ||
        Number(r.expectedGeneration) < 1)) ||
    (Number(r.offset) > 0 && r.expectedVersion === undefined)
  )
    throw new DatasetReadError("invalid_request");
  return r as unknown as DatasetReadRequest;
}
function authorized(
  context: DatasetCallContext,
  b: DatasetResolvedBinding,
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
    (context.subject !== null ||
      (!a.facts.caller.userId &&
        !a.facts.caller.tokenId &&
        !a.facts.caller.groupId)) &&
    datasetReadable(a)
  );
}
function sameRevision(
  b: DatasetResolvedBinding,
  a: DatasetReadAuthority,
): boolean {
  return (
    a.dataset.generation === b.revision.generation &&
    a.dataset.policyRevision === b.revision.policyRevision &&
    (b.mode === "live"
      ? a.dataset.version === b.revision.version
      : b.dataset.version === b.revision.version)
  );
}
async function requireAuthority(
  ports: DatasetReadPorts,
  context: DatasetCallContext,
  b: DatasetResolvedBinding,
): Promise<void> {
  const authority = await ports.authority(context, b);
  if (!authority || !authorized(context, b, authority))
    throw new DatasetReadError("denied");
  if (!sameRevision(b, authority))
    throw new DatasetReadError("dataset_changed");
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
        !["live", "pinned"].includes(b.mode) ||
        !b.revision ||
        !Number.isSafeInteger(b.revision.version) ||
        b.revision.version < 1 ||
        !Number.isSafeInteger(b.revision.generation) ||
        b.revision.generation < 1 ||
        !Number.isSafeInteger(b.revision.policyRevision) ||
        b.revision.policyRevision < 0 ||
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
      await requireAuthority(ports, context, b);
      if (
        r.expectedVersion !== undefined &&
        (r.expectedVersion !== b.revision.version ||
          r.expectedGeneration !== b.revision.generation)
      )
        throw new DatasetReadError("dataset_changed");
      const rows = await readRows(
        table,
        await ports.read(table.object.key, signal),
        signal,
      );
      await requireAuthority(ports, context, b);
      signal?.throwIfAborted();
      const result: DatasetReadResult = {
        version: b.revision.version,
        generation: b.revision.generation,
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
        result.rows.push(projectRow(rows[i]!, table));
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
