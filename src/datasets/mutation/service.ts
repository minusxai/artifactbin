import {
  datasetMutationSystemParameter,
  matchesDatasetMutationScalar,
  validDatasetMutationParameterMap,
  validDatasetMutationValueParameter,
  validDatasetMutationRowParameters,
} from "./parameter-scalars.ts";
import { validateDatasetSqlJob } from "../sql/job.ts";
import type { DatasetCallContext } from "../contracts.ts";
import { selectDatasetMutationPolicy } from "./policy.ts";
import {
  DatasetMutationError,
  DATASET_SQL_LIMITS as limits,
  type DatasetMutationPorts,
  type DatasetMutationRequest,
  type DatasetMutationOperation,
} from "./contracts.ts";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function request(value: unknown): DatasetMutationRequest {
  if (
    !record(value) ||
    Object.keys(value).some(
      (k) => !["operation", "requestId", "params"].includes(k),
    ) ||
    typeof value.operation !== "string" ||
    !value.operation ||
    value.operation.length > 128 ||
    typeof value.requestId !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) ||
    !record(value.params) ||
    Object.keys(value.params).length > limits.maxCallerParams
  )
    throw new DatasetMutationError("invalid_request", "rejected");
  for (const [k, v] of Object.entries(value.params))
    if (
      !k ||
      k.length > 128 ||
      k.startsWith("__policy_") ||
      k.startsWith("_me__") ||
      k === "_now" ||
      k === "_tz" ||
      !(
        v === null ||
        typeof v === "string" ||
        typeof v === "boolean" ||
        (typeof v === "number" && Number.isFinite(v))
      )
    )
      throw new DatasetMutationError("invalid_request", "rejected");
  if (Buffer.byteLength(JSON.stringify(value)) > 64 * 1024)
    throw new DatasetMutationError("invalid_request", "rejected");
  return structuredClone(value) as unknown as DatasetMutationRequest;
}
function bound(
  context: DatasetCallContext,
  operation: DatasetMutationOperation,
): boolean {
  return (
    operation.backendId === context.backendId &&
    operation.backendVersion === context.backendVersion &&
    operation.page.id === context.pageId &&
    Buffer.byteLength(operation.sql) <= limits.maxSqlBytes &&
    (operation.sqlSchema === undefined ||
      (typeof operation.sqlSchema === "string" &&
        !!operation.sqlSchema &&
        operation.sqlSchema.length <= 128 &&
        !operation.sqlSchema.includes("\0")))
  );
}
/** Controller execute port is mandatory: this service never runs SQL on the application event loop. */
export function createDatasetMutationService(ports: DatasetMutationPorts) {
  return {
    async mutate(
      context: DatasetCallContext,
      value: unknown,
      signal?: AbortSignal,
    ) {
      const input = request(value),
        found = await ports.operation(context, input.operation);
      if (!found || !bound(context, found))
        throw new DatasetMutationError("denied", "rejected");
      const operation = structuredClone(found);
      const callerTypes = Object.fromEntries(
        Object.entries(operation.paramTypes).filter(
          ([name]) => !datasetMutationSystemParameter(name),
        ),
      );
      if (
        !validDatasetMutationParameterMap(operation.paramTypes) ||
        !validDatasetMutationValueParameter(
          operation.valueParam,
          operation.paramTypes,
          operation.rowParams,
        ) ||
        !validDatasetMutationRowParameters(
          operation.rowParams,
          operation.paramTypes,
        ) ||
        Object.keys(input.params).length !== Object.keys(callerTypes).length ||
        Object.entries(callerTypes).some(
          ([name, type]) =>
            !Object.hasOwn(input.params, name) ||
            !matchesDatasetMutationScalar(type, input.params[name]),
        ) ||
        Object.keys(input.params).some(
          (k) => !Object.hasOwn(operation.paramTypes, k),
        )
      )
        throw new DatasetMutationError("invalid_request", "rejected");
      const start = await ports.begin(context, operation, input);
      if (start.kind === "replay") return start.result;
      if (start.kind === "refused")
        throw new DatasetMutationError(start.code, "rejected");
      if (start.kind === "busy") throw new DatasetMutationError("inflight");
      const lease = start.lease;
      const terminal = async (code: string): Promise<never> => {
        await ports.refuse(lease, code);
        throw new DatasetMutationError(code, "rejected");
      };
      const head = await ports
        .head(context, operation)
        .catch(() => terminal("authority_unavailable"));
      if (!head) return terminal("denied");
      let selection;
      try {
        selection = selectDatasetMutationPolicy(head, operation);
      } catch {
        return terminal("denied");
      }
      // Anonymous contexts cannot activate legacy caller facts supplied by a compromised mapping adapter.
      if (
        context.subject === null &&
        (head.authority.facts.caller.userId ||
          head.authority.facts.caller.tokenId ||
          head.authority.facts.caller.groupId)
      )
        return terminal("denied");
      const table = head.tables.find(
        (t) =>
          t.schema === operation.target.schema &&
          t.name === operation.target.table,
      );
      if (!table) return terminal("invalid_dataset");
      const rows = await ports
        .read(table)
        .catch(() => terminal("dataset_unavailable"));
      if (
        rows.length > limits.maxRows ||
        rows.length * table.columns.length > limits.maxCells
      )
        return terminal("input_limit");
      if (Object.keys(head.systemParams).length > limits.maxSystemParams)
        return terminal("invalid_job");
      if (operation.readsMembers && !head.members) return terminal("denied");
      const job = {
        kind: "dataset-sql" as const,
        engineVersion: "sqlite-3.53.4-effect-v1" as const,
        input: {
          table: {
            schema: operation.sqlSchema ?? table.schema,
            name: table.name,
            columns: structuredClone([...table.columns]),
            rows,
          },
          ...(operation.readsMembers
            ? {
                reads: [
                  {
                    schema: "main",
                    table: "_members",
                    columns: [
                      { name: "user_id", type: "user" as const },
                      { name: "joined_at", type: "timestamp" as const },
                    ],
                    rows: head.members
                      ? head.members.rows.map((row) => ({ ...row }))
                      : [],
                  },
                ],
              }
            : {}),
          sql: operation.sql,
          params: { ...input.params, ...head.systemParams },
          paramTypes: Object.fromEntries(
            Object.entries(operation.paramTypes).filter(
              ([, type]) => type !== null,
            ),
          ) as Record<string, import("../contracts.ts").DatasetColumn["type"]>,
          ...(selection.policy ? { policy: selection.policy } : {}),
          ...(operation.expectedAffected === undefined
            ? {}
            : { expectedAffected: operation.expectedAffected }),
        },
      };
      if (Buffer.byteLength(JSON.stringify(job)) > limits.inputBytes)
        return terminal("input_limit");
      try {
        validateDatasetSqlJob(job);
      } catch {
        return terminal("invalid_job");
      }
      // Transport exceptions leave the durable lease inflight: execution outcome is unknown, so never replay it.
      const out = await ports.execute(job, signal);
      if ("error" in out)
        return terminal(
          out.code ??
            (out.timedOut
              ? "timed_out"
              : out.full
                ? "dataset_full"
                : "invalid_sql"),
        );
      if (
        !Number.isSafeInteger(out.affected) ||
        out.affected < 0 ||
        !Array.isArray(out.rows) ||
        out.rows.length > limits.maxRows ||
        out.rows.length * table.columns.length > limits.maxCells ||
        JSON.stringify(out.columns) !== JSON.stringify(table.columns) ||
        Buffer.byteLength(JSON.stringify(out)) > limits.outputBytes ||
        !out.analysis ||
        !selection.operations.includes(out.analysis.operation) ||
        (table.columns.some((c) => c.type === "user") &&
          !Array.isArray(out.userWrites))
      )
        return terminal("invalid_effect");
      // Fresh authorization is repeated by the transaction after blob persistence; a stale snapshot is never sufficient.
      const object = await ports.persist(out.rows);
      if (
        !/^[a-f0-9]{64}$/.test(object.key) ||
        object.key !== object.sha256 ||
        !Number.isSafeInteger(object.bytes) ||
        object.bytes < 2 ||
        object.bytes > limits.outputBytes
      )
        return terminal("invalid_object");
      const committed = await ports.commit({
        context,
        operation,
        lease,
        head,
        object,
        outcome: out,
      });
      if (committed.kind === "committed") return committed.result;
      // Even rerun-fresh declarations need a separately claimed durable attempt: this service never silently reexecutes random/time SQL.
      return terminal(committed.kind === "conflict" ? "row_changed" : "denied");
    },
  };
}
