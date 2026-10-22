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
    async availability(context, input, signal) {
      signal?.throwIfAborted();
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).join() !== "name" ||
        typeof (input as { name?: unknown }).name !== "string"
      )
        invalid();
      const name = (input as { name: string }).name;
      const r = await ports.registry(context, name, signal);
      if (
        !r ||
        r.name !== name ||
        r.backendId !== context.backendId ||
        r.backendVersion !== context.backendVersion ||
        r.pageId !== context.pageId ||
        !ports.pool(r.resource)
      )
        return false;
      validateSourceRegistration(r);
      const authority = await ports.authority(context, signal);
      signal?.throwIfAborted();
      return !!authority;
    },
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
      const windowSql =
        "SELECT * FROM (" +
        prepared.text +
        ") AS source_result" +
        order +
        " LIMIT $" +
        (parameters.length + 1) +
        " OFFSET $" +
        (parameters.length + 2);
      // Bound the driver payload before PostgreSQL serializes it to the app.
      // The trusted query window executes once; oversized UTF-8 output is a sentinel.
      const text =
        "WITH source_window AS MATERIALIZED (" +
        windowSql +
        "), source_payload AS MATERIALIZED (SELECT coalesce(jsonb_agg(to_jsonb(source_window)), '[]'::jsonb)::text AS payload FROM source_window) SELECT CASE WHEN octet_length(payload)<=49152 THEN payload ELSE NULL END AS source_rows FROM source_payload";
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
      const response = await host.invoke(
        {
          tenant: context.pageId,
          subject: context.subject ?? "anonymous",
          grants: [{ resource: "source", operation: "read" }],
        },
        { resource: "source", operation: "read", input: null },
        signal,
      );
      if (
        !Array.isArray(response) ||
        response.length !== 1 ||
        !response[0] ||
        typeof response[0] !== "object" ||
        Array.isArray(response[0]) ||
        typeof response[0].source_rows !== "string" ||
        Buffer.byteLength(response[0].source_rows) > 49152
      )
        throw new DatasetReadError("invalid_dataset");
      let raw: unknown;
      try {
        raw = JSON.parse(response[0].source_rows);
      } catch {
        throw new DatasetReadError("invalid_dataset");
      }
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
