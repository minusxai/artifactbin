import { jsonCopy } from "../json.ts";
import {
  BackendHostError,
  boundedDetail,
  type BackendJson,
  type BackendCapabilityRequest,
} from "./contracts.ts";
import type {
  SandboxCallOptions,
  SandboxCallProtocol,
} from "./runtime-contracts.ts";
const FRAME_BYTES = 1500000;
/** Per-call accounting of the capability bridge; every limit is per call. */
interface CallLimits {
  count: number;
  pending: number;
  requestBytes: number;
  responseBytes: number;
  ids: Set<number>;
}
const callLimits = (): CallLimits => ({
  count: 0,
  pending: 0,
  requestBytes: 0,
  responseBytes: 0,
  ids: new Set(),
});
function record(
  value: BackendJson | undefined,
): value is { [key: string]: BackendJson } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Decode an untrusted JSON frame into the only authority requests handlers accept. */
function checkedCapabilityFrame(
  value: BackendJson,
  limits: CallLimits,
  attached: boolean,
): { id: number; request: BackendCapabilityRequest } {
  if (
    !record(value) ||
    Object.keys(value).sort().join() !== "id,kind,request" ||
    !attached ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    value.id < 1 ||
    limits.ids.has(value.id) ||
    ++limits.count > 100 ||
    ++limits.pending > 8
  )
    throw Error();
  const id = value.id;
  limits.ids.add(id);
  const req = value.request;
  limits.requestBytes += Buffer.byteLength(JSON.stringify(req));
  if (
    limits.requestBytes > 1048576 ||
    !record(req) ||
    Buffer.byteLength(JSON.stringify(req)) > 65536
  )
    throw Error();
  if (req.kind === "store") {
    if (
      req.operation === "get" &&
      Object.keys(req).sort().join() === "kind,operation"
    )
      return { id, request: { kind: "store", operation: "get" } };
    if (
      req.operation === "set" &&
      Object.keys(req).sort().join() === "expected,kind,operation,value" &&
      typeof req.expected === "number" &&
      Number.isSafeInteger(req.expected) &&
      req.expected >= 0 &&
      req.value !== undefined
    )
      return {
        id,
        request: {
          kind: "store",
          operation: "set",
          expected: req.expected,
          value: req.value,
        },
      };
    throw Error();
  }
  if (req.kind === "dataset") {
    if (req.operation === "members" || req.operation === "viewer") {
      if (Object.keys(req).sort().join() !== "kind,operation") throw Error();
      return { id, request: { kind: "dataset", operation: req.operation } };
    }
    const input = req.input;
    if(req.operation === "userChoices"){
      if(Object.keys(req).sort().join()!=="input,kind,operation"||!record(input)||Object.keys(input).sort().join()!=="column,name"||typeof input.name!=="string"||typeof input.column!=="string")throw Error();
      return{id,request:{kind:"dataset",operation:"userChoices",input:{name:input.name,column:input.column}}};
    }
    if(req.operation === "sourceQueryAvailability"){
      if(Object.keys(req).sort().join()!=="input,kind,operation"||!record(input)||Object.keys(input).join()!=="name"||typeof input.name!=="string")throw Error();
      return{id,request:{kind:"dataset",operation:"sourceQueryAvailability",input:{name:input.name}}};
    }
    if (req.operation === "sourceQuery") {
      if(Object.keys(req).sort().join()!=="input,kind,operation"||!record(input)||Object.keys(input).some(k=>!["name","valuesJson","offset","limit","sortJson"].includes(k))||typeof input.name!=="string"||typeof input.valuesJson!=="string"||!Number.isSafeInteger(input.offset)||!Number.isSafeInteger(input.limit)||(input.sortJson!=null&&typeof input.sortJson!=="string"))throw Error();
      return {id,request:{kind:"dataset",operation:"sourceQuery",input:input as unknown as import("../datasets/source-query/contracts.ts").SourceQueryRequest}};
    }
    if (req.operation === "mutationAvailability") {
      if(Object.keys(req).sort().join()!=="input,kind,operation"||!record(input)||Object.keys(input).join()!=="operation"||typeof input.operation!=="string"||!input.operation||input.operation.length>128||["__proto__","constructor","prototype"].includes(input.operation))throw Error();
      return {id,request:{kind:"dataset",operation:"mutationAvailability",input:{operation:input.operation}}};
    }
    if (req.operation === "person") {
      if (
        Object.keys(req).sort().join() !== "input,kind,operation" ||
        !record(input) ||
        Object.keys(input).sort().join() !== "userId,valueName" ||
        typeof input.valueName !== "string" ||
        !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(input.valueName) ||
        ["constructor", "prototype", "__proto__"].includes(input.valueName) ||
        typeof input.userId !== "string" ||
        !input.userId ||
        Buffer.byteLength(input.userId) > 16384
      )
        throw Error();
      return {
        id,
        request: {
          kind: "dataset",
          operation: "person",
          input: { valueName: input.valueName, userId: input.userId },
        },
      };
    }
    if (req.operation === "mutate") {
      if (
        Object.keys(req).sort().join() !== "input,kind,operation" ||
        !record(input) ||
        Object.keys(input).sort().join() !== "operation,params,requestId" ||
        typeof input.operation !== "string" ||
        !input.operation ||
        input.operation.length > 128 ||
        typeof input.requestId !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) ||
        !record(input.params) ||
        Object.keys(input.params).length > 256
      )
        throw Error();
      const params: Record<string, string | number | boolean | null> = {};
      for (const [key, value] of Object.entries(input.params)) {
        if (
          !key ||
          key.length > 128 ||
          key.startsWith("__policy_") ||
          key.startsWith("_me__") ||
          key === "_now" ||
          !(
            value === null ||
            typeof value === "string" ||
            typeof value === "boolean" ||
            (typeof value === "number" && Number.isFinite(value))
          )
        )
          throw Error();
        Object.defineProperty(params, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return {
        id,
        request: {
          kind: "dataset",
          operation: "mutate",
          input: {
            operation: input.operation,
            requestId: input.requestId,
            params,
          },
        },
      };
    }
    if (
      req.operation !== "read" ||
      Object.keys(req).sort().join() !== "input,kind,operation" ||
      !record(input) ||
      ![
        "binding,limit,offset,schema,table",
        "binding,expectedGeneration,expectedVersion,limit,offset,schema,table",
      ].includes(Object.keys(input).sort().join()) ||
      (input.expectedVersion !== undefined &&
        (typeof input.expectedVersion !== "number" ||
          !Number.isSafeInteger(input.expectedVersion) ||
          input.expectedVersion < 1 ||
          typeof input.expectedGeneration !== "number" ||
          !Number.isSafeInteger(input.expectedGeneration) ||
          input.expectedGeneration < 1)) ||
      (input.expectedVersion === undefined &&
        input.expectedGeneration !== undefined) ||
      (typeof input.offset === "number" &&
        input.offset > 0 &&
        input.expectedVersion === undefined) ||
      typeof input.binding !== "string" ||
      !input.binding ||
      typeof input.schema !== "string" ||
      !input.schema ||
      typeof input.table !== "string" ||
      !input.table ||
      typeof input.offset !== "number" ||
      !Number.isSafeInteger(input.offset) ||
      input.offset < 0 ||
      typeof input.limit !== "number" ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 10000
    )
      throw Error();
    return {
      id,
      request: {
        kind: "dataset",
        operation: "read",
        input: {
          binding: input.binding,
          schema: input.schema,
          table: input.table,
          offset: input.offset,
          limit: input.limit,
          ...(input.expectedVersion !== undefined
            ? {
                expectedVersion: input.expectedVersion,
                expectedGeneration: input.expectedGeneration as number,
              }
            : {}),
        },
      },
    };
  }
  if (typeof req.resource !== "string" || !req.resource) throw Error();
  if (
    req.kind === "invoke" &&
    Object.keys(req).sort().join() === "input,kind,operation,resource" &&
    typeof req.operation === "string" &&
    req.operation &&
    req.input !== undefined
  )
    return {
      id,
      request: {
        kind: "invoke",
        resource: req.resource,
        operation: req.operation,
        input: req.input,
      },
    };
  if (
    req.kind !== "transaction" ||
    Object.keys(req).sort().join() !== "kind,operations,resource" ||
    !Array.isArray(req.operations) ||
    !req.operations.length ||
    req.operations.length > 100
  )
    throw Error();
  const operations = req.operations.map((op) => {
    if (
      !record(op) ||
      Object.keys(op).sort().join() !== "input,operation" ||
      typeof op.operation !== "string" ||
      !op.operation ||
      op.input === undefined
    )
      throw Error();
    return { operation: op.operation, input: op.input };
  });
  return {
    id,
    request: { kind: "transaction", resource: req.resource, operations },
  };
}
/** Untrusted sandbox verdicts map only to this bounded public failure vocabulary. */
export function sandboxFailure(
  result: unknown,
): ConstructorParameters<typeof BackendHostError>[0] {
  const code = (result as { code?: unknown } | null)?.code;
  return code === "memory_limit" ||
    code === "build_rejected" ||
    code === "output_quota" ||
    code === "store_limit" ||
    code === "dataset_changed" ||
    code === "dataset_mutation_rejected"
    ? code
    : "backend_rejected";
}
/** Owns one invocation's terminal state, budgets and trusted capability dispatch. */
export function createSandboxCall(
  options: SandboxCallOptions,
): SandboxCallProtocol {
  const limits = callLimits();
  let stopped = false,
    bytes = 0,
    closing: Promise<void> | undefined;
  const controller = new AbortController(),
    pending = new Set<Promise<void>>();
  const abort = () => {
    stopped = true;
    controller.abort();
  };
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const fail = (
    code: ConstructorParameters<typeof BackendHostError>[0],
    detail?: string,
  ) => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    options.failure(new BackendHostError(code, detail));
  };
  return {
    close() {
      if (closing) return closing;
      let finish!: () => void;
      closing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      stopped = true;
      options.signal.removeEventListener("abort", abort);
      controller.abort();
      void Promise.allSettled([...pending]).then(() => finish());
      return closing;
    },
    receive(raw) {
      if (stopped || options.signal.aborted) return;
      try {
        bytes += raw.byteLength + 1;
        if (raw.byteLength > FRAME_BYTES || bytes > FRAME_BYTES * 2)
          return fail("output_quota");
        const result: BackendJson = jsonCopy(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
        );
        if (!record(result)) throw Error();
        if (result.kind === "result") {
          if (limits.pending) throw Error();
          if (result.ok !== true)
            return fail(sandboxFailure(result), boundedDetail(result.message));
          if (result.value === undefined) throw Error();
          if (Buffer.byteLength(JSON.stringify(result.value)) > 65536)
            return fail("output_quota");
          stopped = true;
          options.result(result.value);
          return;
        }
        if (result?.kind !== "capability") throw Error();
        const capability = checkedCapabilityFrame(
          result,
          limits,
          Boolean(options.handler),
        );
        const dispatched = Promise.resolve()
          .then(() => {
            if (stopped || options.signal.aborted) throw Error();
            return options.handler!(
              options.principal,
              capability.request,
              controller.signal,
            );
          })
          .then((value) => {
            const copy: BackendJson = jsonCopy(value);
            const size = Buffer.byteLength(JSON.stringify(copy));
            limits.responseBytes += size;
            if (size > 65536 || limits.responseBytes > 1048576) throw Error();
            return {
              kind: "capability-result",
              id: capability.id,
              ok: true,
              value: copy,
            };
          })
          .catch((error: unknown) => {
            const storeLimit =
              (error as { code?: unknown })?.code === "store_limit";
            const datasetChanged =
              error instanceof BackendHostError &&
              error.code === "dataset_changed";
            const mutationRejected =
              error instanceof BackendHostError &&
              error.code === "dataset_mutation_rejected";
            return {
              kind: "capability-result",
              id: capability.id,
              ok: false,
              code: storeLimit
                ? "store_limit"
                : datasetChanged
                  ? "dataset_changed"
                  : mutationRejected
                    ? "dataset_mutation_rejected"
                    : "capability_rejected",
              outcome:
                storeLimit || datasetChanged || mutationRejected
                  ? "rejected"
                  : "unknown",
            };
          })
          .then((reply) => {
            limits.pending--;
            if (!stopped && !options.signal.aborted) options.reply(reply);
          })
          .catch(() => fail("backend_rejected"));
        pending.add(dispatched);
        void dispatched.finally(() => pending.delete(dispatched));
      } catch {
        fail("backend_rejected");
      }
    },
  };
}
