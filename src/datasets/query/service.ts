import {
  SERVER_QUERY_LIMITS as limits,
  type DatasetQueryJob,
  type RegisteredServerQueryPorts,
  type RegisteredServerQueryService,
  type RegisteredServerQueryOptions,
  type RegisteredServerQueryIdentity,
} from "./contracts.ts";
import {
  name,
  record,
  scalar,
  validateDatasetQueryJob,
  decodeDatasetQueryAnswer,
} from "../sql/read-job.ts";
import type { Scalar, ColumnType } from "../sql/engine/sql-contracts.ts";
function typed(v: unknown, type: ColumnType): v is Scalar {
  if (v === null) return true;
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  if (type === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
    );
  if (type === "timestamp") return Number.isFinite(Date.parse(v));
  return type === "string" || type === "user";
}
export function createRegisteredServerQueryService(
  ports: RegisteredServerQueryPorts,
  options: RegisteredServerQueryOptions = {},
): RegisteredServerQueryService {
  return {
    async execute(callerContext, request, signal) {
      const context = Object.freeze({
        backendId: callerContext.backendId,
        backendVersion: callerContext.backendVersion,
        pageId: callerContext.pageId,
        subject: callerContext.subject,
        pageVersion: callerContext.pageVersion,
        sourceSha256: callerContext.sourceSha256,
      });
      if (
        ![context.backendId, context.backendVersion, context.pageId].every(
          (v) => typeof v === "string" && v.length > 0 && v.length <= 512,
        ) ||
        (context.subject !== null &&
          (typeof context.subject !== "string" ||
            !context.subject ||
            context.subject.length > 512)) ||
        !Number.isSafeInteger(context.pageVersion) ||
        context.pageVersion < 1 ||
        !/^[a-f0-9]{64}$/.test(context.sourceSha256)
      )
        throw Error("invalid_query_context");
      const abort = new AbortController();
      const forward = () => abort.abort(signal?.reason);
      signal?.addEventListener("abort", forward, { once: true });
      if (signal?.aborted) forward();
      const cancelDeadline = (
        options.scheduleDeadline ??
        ((milliseconds, expire) => {
          const timer = setTimeout(expire, milliseconds);
          return () => clearTimeout(timer);
        })
      )(limits.wallMs, () => abort.abort(Error("query_deadline")));
      const wait = <T>(start: () => Promise<T>): Promise<T> => {
        abort.signal.throwIfAborted();
        return new Promise<T>((resolve, reject) => {
          const cancel = () => {
            abort.signal.removeEventListener("abort", cancel);
            reject(abort.signal.reason ?? Error("cancelled"));
          };
          abort.signal.addEventListener("abort", cancel, { once: true });
          try {
            Promise.resolve(start()).then(
              (value) => {
                abort.signal.removeEventListener("abort", cancel);
                if (abort.signal.aborted)
                  reject(abort.signal.reason ?? Error("cancelled"));
                else resolve(value);
              },
              (error) => {
                abort.signal.removeEventListener("abort", cancel);
                reject(error);
              },
            );
          } catch (error) {
            abort.signal.removeEventListener("abort", cancel);
            reject(error);
          }
        });
      };
      try {
        abort.signal.throwIfAborted();
        if (
          !record(request) ||
          Object.keys(request).some((k) => !["values", "only"].includes(k)) ||
          !record(request.values) ||
          !Array.isArray(request.only) ||
          request.only.length > limits.maxQueries ||
          request.only.some((q) => !name(q)) ||
          new Set(request.only).size !== request.only.length ||
          Object.keys(request.values).length > limits.maxParams ||
          Object.values(request.values).some((v) => !scalar(v)) ||
          Buffer.byteLength(JSON.stringify(request)) > limits.inputBytes
        )
          throw Error("invalid_query_request");
        const input = structuredClone({
          values: request.values,
          only: request.only as string[],
        });
        const plan = structuredClone(
          await wait(() => ports.registry(context, abort.signal)),
        );
        if (!plan) throw Error("denied");
        const identity = plan.registration;
        const keys = [
          "backendId",
          "backendVersion",
          "pageId",
          "pageVersion",
          "sourceSha256",
        ] as const;
        if (
          !identity ||
          keys.some((key) => identity[key] !== context[key]) ||
          Object.keys(identity).length !== keys.length
        )
          throw Error("invalid_query_registry");
        const registration: Readonly<RegisteredServerQueryIdentity> =
          Object.freeze({ ...identity });
        if (
          !(await wait(() =>
            ports.authorize(context, registration, abort.signal),
          ))
        )
          throw Error("denied");
        if (
          plan.queries.length > limits.maxQueries ||
          plan.imports.length + plan.tables.length > limits.maxTables ||
          Object.keys(plan.scalars).length > limits.maxParams
        )
          throw Error("invalid_query_registry");
        const params: Record<string, Scalar> = Object.create(null),
          paramTypes: Record<string, ColumnType> = Object.create(null);
        if (
          Object.keys(input.values).some((k) => !Object.hasOwn(plan.scalars, k))
        )
          throw Error("invalid_query_request");
        for (const [k, d] of Object.entries(plan.scalars)) {
          const v = Object.hasOwn(input.values, k)
            ? input.values[k]
            : d.default;
          if (
            !name(k) ||
            k.startsWith("_") ||
            !typed(d.default, d.type) ||
            !typed(v, d.type)
          )
            throw Error("invalid_query_request");
          params[k] = v;
          paramTypes[k] = d.type;
        }
        const platform = await wait(() =>
          ports.platform(context, abort.signal),
        );
        if (
          (platform.userId !== null &&
            (typeof platform.userId !== "string" || !platform.userId)) ||
          !typed(platform.now, "timestamp") ||
          typeof platform.now !== "string" ||
          typeof platform.tz !== "string" ||
          !platform.tz ||
          platform.tz.length > 64
        )
          throw Error("invalid_query_platform");
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: platform.tz });
        } catch {
          throw Error("invalid_query_platform");
        }
        Object.assign(params, {
          _me__id: platform.userId,
          _now: platform.now,
          _tz: platform.tz,
        });
        Object.assign(paramTypes, {
          _me__id: "user",
          _now: "timestamp",
          _tz: "string",
        });
        const queries = new Map(plan.queries.map((q) => [q.name, q]));
        if (queries.size !== plan.queries.length)
          throw Error("invalid_query_registry");
        const ordered: DatasetQueryJob["input"]["queries"] = [],
          visiting = new Set<string>(),
          visited = new Set<string>();
        const visit = (key: string) => {
          if (visited.has(key)) return;
          const q = queries.get(key);
          if (!q || visiting.has(key)) throw Error("invalid_query_request");
          visiting.add(key);
          for (const dep of q.dependencies) visit(dep);
          visiting.delete(key);
          visited.add(key);
        };
        for (const key of input.only) visit(key);
        const completed = new Set<string>();
        for (const q of plan.queries) {
          if (!visited.has(q.name)) continue;
          if (q.dependencies.some((dep) => !completed.has(dep)))
            throw Error("invalid_query_registry");
          completed.add(q.name);
          ordered.push({ name: q.name, sql: q.sql });
        }
        const tables = structuredClone(
          plan.tables,
        ) as DatasetQueryJob["input"]["tables"];
        tables.push({
          schema: "main",
          table: "_me",
          columns: [{ name: "id", type: "user" }],
          rows: [{ id: platform.userId }],
        });
        const job: DatasetQueryJob = {
          kind: "dataset-query",
          engineVersion: "sqlite-3.53.4-read-v1",
          input: { tables, queries: ordered, params, paramTypes },
        };
        validateDatasetQueryJob(job);
        const pins: {
          read: (typeof plan.imports)[number]["read"];
          expectedVersion: number;
          expectedGeneration: number;
        }[] = [];
        for (const relation of plan.imports) {
          if (!name(relation.schema) || !name(relation.table))
            throw Error("invalid_query_registry");
          let offset = 0,
            version: number | undefined,
            generation: number | undefined;
          const table: DatasetQueryJob["input"]["tables"][number] = {
            schema: relation.schema,
            table: relation.table,
            columns: [],
            rows: [],
          };
          tables.push(table);
          do {
            const window = await wait(() =>
              ports.reads.read(
                context,
                {
                  ...relation.read,
                  offset,
                  limit: 500,
                  ...(version === undefined
                    ? {}
                    : {
                        expectedVersion: version,
                        expectedGeneration: generation,
                      }),
                },
                abort.signal,
              ),
            );
            if (
              version !== undefined &&
              (version !== window.version || generation !== window.generation)
            )
              throw Error("dataset_changed");
            if (
              window.schema !== relation.read.schema ||
              window.table !== relation.read.table ||
              window.offset !== offset ||
              (window.nextOffset !== null &&
                (!Number.isSafeInteger(window.nextOffset) ||
                  window.nextOffset !== offset + window.rows.length ||
                  window.rows.length === 0))
            )
              throw Error("invalid_query_input");
            if (version === undefined) {
              version = window.version;
              generation = window.generation;
              table.columns = [...window.columns];
            } else if (
              JSON.stringify(table.columns) !== JSON.stringify(window.columns)
            )
              throw Error("dataset_changed");
            table.rows.push(...window.rows);
            validateDatasetQueryJob(job);
            offset = window.nextOffset ?? -1;
          } while (offset !== -1);
          pins.push({
            read: relation.read,
            expectedVersion: version!,
            expectedGeneration: generation!,
          });
        }
        const answer = decodeDatasetQueryAnswer(
          job,
          await wait(() => ports.execute(job, abort.signal)),
        );
        for (const pin of pins) {
          const r = await wait(() =>
            ports.reads.read(
              context,
              {
                ...pin.read,
                offset: 0,
                limit: 1,
                expectedVersion: pin.expectedVersion,
                expectedGeneration: pin.expectedGeneration,
              },
              abort.signal,
            ),
          );
          if (
            r.version !== pin.expectedVersion ||
            r.generation !== pin.expectedGeneration
          )
            throw Error("dataset_changed");
        }
        if (
          !(await wait(() =>
            ports.authorize(context, registration, abort.signal),
          ))
        )
          throw Error("denied");
        abort.signal.throwIfAborted();
        return answer;
      } finally {
        cancelDeadline();
        signal?.removeEventListener("abort", forward);
        abort.abort();
      }
    },
  };
}
