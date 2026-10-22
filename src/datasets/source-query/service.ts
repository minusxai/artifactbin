import { createConnectorHost } from "../../connectors/index.ts";
import { DatasetReadError } from "../contracts.ts";
import type {
  SourceQueryPorts,
  SourceQueryService,
  SourceQueryRequest,
} from "./contracts.ts";
import type { Scalar } from "../sql/engine/sql-contracts.ts";
import { prepareSourceSql, validateSourceRegistration } from "./sql.ts";
const invalid = (): never => {
  throw new DatasetReadError("invalid_request");
};
const reserved = new Set(["_me__id", "_now", "_tz"]);
function scalar(value: unknown, type: string): value is Scalar {
  return (
    value === null ||
    (type === "number"
      ? typeof value === "number" && Number.isFinite(value)
      : type === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string" && value.length <= 65536)
  );
}
/** Exact registered named operation. Runner input can supply typed authored scalars, never SQL/resource/identity. */
export function createSourceQueryService(
  ports: SourceQueryPorts,
): SourceQueryService {
  return {
    async query(context, input, signal) {
      signal?.throwIfAborted();
      if (!input || typeof input !== "object" || Array.isArray(input))
        invalid();
      const r = input as SourceQueryRequest;
      if (
        Object.keys(r).some(
          (k) =>
            !["name", "valuesJson", "offset", "limit", "sortJson"].includes(k),
        ) ||
        typeof r.name !== "string" ||
        typeof r.valuesJson !== "string" ||
        r.valuesJson.length > 65536 ||
        !Number.isSafeInteger(r.offset) ||
        r.offset < 0 ||
        r.offset > 1000000 ||
        !Number.isSafeInteger(r.limit) ||
        r.limit < 1 ||
        r.limit > 1000
      )
        invalid();
      const registration = await ports.registry(context, r.name, signal);
      if (
        !registration ||
        registration.name !== r.name ||
        registration.backendId !== context.backendId ||
        registration.backendVersion !== context.backendVersion ||
        registration.pageId !== context.pageId
      )
        throw new DatasetReadError("denied");
      validateSourceRegistration(registration);
      const first = await ports.authority(context, signal);
      if (!first) throw new DatasetReadError("denied");
      let values: Record<string, Scalar> = {};
      try {
        values = JSON.parse(r.valuesJson);
      } catch {
        invalid();
      }
      if (!values! || typeof values !== "object" || Array.isArray(values))
        invalid();
      if (
        Object.keys(values).some(
          (k) => reserved.has(k) || !Object.hasOwn(registration.params, k),
        ) ||
        Object.entries(registration.params).some(
          ([k, t]) =>
            !reserved.has(k) &&
            (!Object.hasOwn(values, k) || !scalar(values[k], t)),
        )
      )
        invalid();
      const platform: Record<string, Scalar> = {
        _me__id: first.userId,
        _now: first.now,
        _tz: first.tz,
      };
      const prepared = prepareSourceSql(
        registration.executionSql ?? registration.sql,
      );
      let order = "";
      if (r.sortJson != null) {
        let sort: any;
        try {
          sort = JSON.parse(r.sortJson);
        } catch {
          invalid();
        }
        if (
          !sort ||
          Object.keys(sort).sort().join(",") !== "col,dir" ||
          !["asc", "desc"].includes(sort.dir) ||
          !registration.columns.some((c) => c.name === sort.col)
        )
          invalid();
        order =
          " ORDER BY " + '"' + sort.col.replaceAll('"', '""') + '" ' + sort.dir;
      }
      const parameters = prepared.names.map((name) =>
        reserved.has(name) ? platform[name]! : values[name]!,
      );
      const text =
        "SELECT * FROM (" +
        prepared.text +
        ") AS source_result" +
        order +
        " LIMIT $" +
        (parameters.length + 1) +
        " OFFSET $" +
        (parameters.length + 2);
      const pool = ports.pool(registration.resource);
      if (!pool) throw new DatasetReadError("denied");
      const host = createConnectorHost(
        {
          source: {
            kind: "postgres",
            pool,
            readOnly: true,
            operations: {
              read: {
                text,
                params: () => [...parameters, r.limit + 1, r.offset],
              },
            },
          },
        },
        {
          timeoutMs: 5000,
          maxBytes: 1024 * 1024,
          maxActive: 1,
          maxPendingAcquisitions: 1,
        },
      );
      const raw = await host.invoke(
        {
          tenant: context.pageId,
          subject: context.subject ?? "anonymous",
          grants: [{ resource: "source", operation: "read" }],
        },
        { resource: "source", operation: "read", input: null },
        signal,
      );
      signal?.throwIfAborted();
      const fresh = await ports.authority(context, signal);
      if (
        !fresh ||
        fresh.generation !== first.generation ||
        fresh.userId !== first.userId
      )
        throw new DatasetReadError("dataset_changed");
      if (
        !Array.isArray(raw) ||
        raw.some((row) => !row || typeof row !== "object" || Array.isArray(row))
      )
        throw new DatasetReadError("invalid_dataset");
      const rows = raw.slice(0, r.limit).map((row) =>
        Object.fromEntries(
          registration.columns.map((c) => {
            let value = (row as Record<string, Scalar>)[c.name];
            if (
              c.type === "number" &&
              typeof value === "string" &&
              value.trim() &&
              Number.isFinite(Number(value))
            )
              value = Number(value);
            if (!Object.hasOwn(row as object, c.name) || !scalar(value, c.type))
              throw new DatasetReadError("invalid_dataset");
            return [c.name, value];
          }),
        ),
      );
      return {
        columns: registration.columns.map((c) => ({
          name: c.name,
          type: c.type,
        })),
        rows,
        ...(raw.length > r.limit ? { truncated: true } : {}),
      };
    },
  };
}
