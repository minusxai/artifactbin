import type {
  ConnectorBinding,
  ConnectorCaller,
  ConnectorHost,
  ConnectorOperation,
  ConnectorOptions,
} from "./contracts.ts";
import { ConnectorError, snapshot } from "./json.ts";
import { destination, invokeHttp } from "./http.ts";
import { invokePostgres } from "./postgres.ts";
import { createLifetime } from "./lifetime.ts";
export * from "./contracts.ts";
export { ConnectorError } from "./json.ts";
export function createConnectorHost(
  config: Record<string, ConnectorBinding>,
  options: ConnectorOptions = {},
): ConnectorHost {
  const {
    timeoutMs = 1000,
    maxBytes = 65536,
    maxActive = 16,
    maxPendingAcquisitions = 16,
    maxTransactionOperations = 100,
    allowLoopbackHttp = false,
  } = options;
  for (const n of [
    timeoutMs,
    maxBytes,
    maxActive,
    maxPendingAcquisitions,
    maxTransactionOperations,
  ])
    if (!Number.isSafeInteger(n) || n < 1) throw new ConnectorError("INVALID");
  const bindings: Record<string, ConnectorBinding> = Object.create(null);
  for (const [name, binding] of Object.entries(config)) {
    const operations = Object.fromEntries(
      Object.entries(binding.operations).map(([key, op]) => [
        key,
        Object.freeze({ ...op }),
      ]),
    );
    const copied = Object.freeze({
      ...binding,
      operations: Object.freeze(operations),
    }) as ConnectorBinding;
    if (copied.kind === "http")
      for (const op of Object.values(copied.operations))
        destination(copied, op, allowLoopbackHttp);
    bindings[name] = copied;
  }
  let closed = false,
    closing: Promise<void> | undefined;
  const lifetime = createLifetime(maxActive, timeoutMs);
  const budget = { pending: 0, limit: maxPendingAcquisitions };
  function capture(caller: ConnectorCaller): ConnectorCaller {
    return snapshot(caller, maxBytes) as unknown as ConnectorCaller;
  }
  function authorize(
    caller: ConnectorCaller,
    resource: string,
    operation: string,
  ): ConnectorBinding {
    if (closed) throw new ConnectorError("CLOSED");
    if (
      !caller ||
      typeof caller.tenant !== "string" ||
      !caller.tenant ||
      typeof caller.subject !== "string" ||
      !caller.subject ||
      !Array.isArray(caller.grants) ||
      !caller.grants.some(
        (g) => g && g.resource === resource && g.operation === operation,
      ) ||
      !Object.hasOwn(bindings, resource)
    )
      throw new ConnectorError("DENIED");
    const b = bindings[resource]!;
    if (
      ["__proto__", "prototype", "constructor", "toString", "valueOf"].includes(
        resource,
      ) ||
      ["__proto__", "prototype", "constructor", "toString", "valueOf"].includes(
        operation,
      ) ||
      !Object.hasOwn(b.operations, operation)
    )
      throw new ConnectorError("DENIED");
    return b;
  }
  return {
    async invoke(caller, request, signal) {
      caller = capture(caller);
      const r = snapshot(request, maxBytes) as unknown as typeof request;
      if (
        !r ||
        typeof r.resource !== "string" ||
        typeof r.operation !== "string" ||
        !Object.hasOwn(r, "input")
      )
        throw new ConnectorError("INVALID");
      const b = authorize(caller, r.resource, r.operation);
      return lifetime.run(signal, async (s, dispatch) => {
        if (b.kind === "postgres")
          return (
            await invokePostgres(
              b,
              caller,
              [r],
              s,
              maxBytes,
              timeoutMs,
              budget,
              dispatch,
            )
          )[0]!;
        return invokeHttp(
          b,
          b.operations[r.operation]!,
          caller,
          r.input,
          s,
          maxBytes,
          allowLoopbackHttp,
          dispatch,
        );
      });
    },
    async transaction(caller, resource, operations, signal) {
      caller = capture(caller);
      const ops = snapshot(
        operations,
        maxBytes,
      ) as unknown as ConnectorOperation[];
      if (
        !Array.isArray(ops) ||
        !ops.length ||
        ops.length > maxTransactionOperations
      )
        throw new ConnectorError("INVALID");
      if (!ops[0] || typeof ops[0].operation !== "string")
        throw new ConnectorError("INVALID");
      const b = authorize(caller, resource, ops[0]!.operation);
      if (b.kind !== "postgres") throw new ConnectorError("INVALID");
      for (const op of ops) {
        if (
          !op ||
          typeof op.operation !== "string" ||
          !Object.hasOwn(op, "input")
        )
          throw new ConnectorError("INVALID");
        authorize(caller, resource, op.operation);
      }
      return lifetime.run(signal, (s, dispatch) =>
        invokePostgres(
          b,
          caller,
          ops,
          s,
          maxBytes,
          timeoutMs,
          budget,
          dispatch,
        ),
      );
    },
    close() {
      if (closing) return closing;
      closed = true;
      lifetime.close();
      closing = Promise.all(
        [
          ...new Set(
            Object.values(bindings)
              .filter((b) => b.kind === "postgres")
              .map((b) => b.pool),
          ),
        ].map((pool) => pool.end()),
      ).then(() => {});
      return closing;
    },
  };
}
