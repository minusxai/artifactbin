import type {
  CompiledDatasetMutationOptions,
  CompiledDatasetMutationAdapter,
  CompiledMutationResult,
  CompiledMutationScalar,
  CompiledMutationStatus,
} from "./dataset-mutations-contracts.ts";
export type * from "./dataset-mutations-contracts.ts";
export class CompiledDatasetMutationError extends Error {
  readonly outcome: "rejected" | "offline" | "unknown";
  constructor(outcome: "rejected" | "offline" | "unknown") {
    super(`Dataset mutation ${outcome}`);
    this.name = "CompiledDatasetMutationError";
    this.outcome = outcome;
  }
}
const identifier = (value: string) =>
  typeof value === "string" &&
  /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(value) &&
  !["constructor", "prototype", "__proto__"].includes(value);
const scalar = (v: unknown): v is CompiledMutationScalar =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));
const matches = (type: string, value: CompiledMutationScalar) =>
  value === null ||
  (type === "number"
    ? typeof value === "number"
    : type === "boolean"
      ? typeof value === "boolean"
      : typeof value === "string");
const validResult = (v: any): v is CompiledMutationResult =>
  !!v &&
  typeof v === "object" &&
  ["affected", "rowCount", "version", "generation"].every(
    (k) => Number.isSafeInteger(v[k]) && v[k] >= 0,
  ) &&
  v.version > 0;
interface Attempt {
  status: CompiledMutationStatus;
  params: Record<string, CompiledMutationScalar>;
  viewer: Record<string, CompiledMutationScalar>;
  promise?: Promise<CompiledMutationResult>;
  effectsApplied?: boolean;
}
/** One helper per rendered page. Canonical Apollo owns transport and credentials. */
export function createCompiledDatasetMutations(
  options: CompiledDatasetMutationOptions,
): CompiledDatasetMutationAdapter {
  const bindings = new Map(options.bindings.map((b) => [b.name, b])),
    attempts = new Map<string, Attempt>(),
    listeners = new Set<() => void>();
  if (bindings.size !== options.bindings.length)
    throw Error("Invalid registered mutation metadata");
  for (const b of bindings.values())
    if (
      !identifier(b.name) ||
      !identifier(b.backendNamespace) ||
      !options.documents[b.backendNamespace] ||
      Object.keys(b.paramTypes).length > 240 ||
      Object.entries(b.paramTypes).some(
        ([name, type]) =>
          !identifier(name) ||
          ![
            "string",
            "number",
            "boolean",
            "date",
            "timestamp",
            "user",
          ].includes(type),
      ) ||
      b.reset?.some((name) => !identifier(name))
    )
      throw Error("Invalid registered mutation metadata");
  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Observers cannot change the write outcome. */
      }
    }
  };
  const execute = (
    name: string,
    attempt: Attempt,
  ): Promise<CompiledMutationResult> => {
    if (attempt.promise) return attempt.promise;
    const binding = bindings.get(name)!;
    attempt.status = { ...attempt.status, state: "pending" };
    emit();
    const work = async () => {
      let wire: Awaited<
        ReturnType<CompiledDatasetMutationOptions["client"]["mutate"]>
      >;
      try {
        wire = await options.client.mutate({
          mutation: options.documents[binding.backendNamespace]!,
          variables: {
            operation: name,
            requestId: attempt.status.requestId,
            params: { ...attempt.params },
          },
        });
      } catch {
        attempt.status = { ...attempt.status, state: "unknown" };
        emit();
        throw new CompiledDatasetMutationError("unknown");
      }
      const outcome =
        wire.extensions?.outcomes?.[binding.backendNamespace + ".mutate"];
      const data = wire.data as Record<string, unknown> | null;
      const payload = (
        data?.[binding.backendNamespace] as Record<string, unknown> | undefined
      )?.mutate;
      if (
        outcome !== "committed" ||
        wire.errors?.length ||
        !validResult(payload)
      ) {
        const state =
          outcome === "rejected"
            ? "rejected"
            : outcome === "offline"
              ? "offline"
              : "unknown";
        attempt.status = { ...attempt.status, state };
        emit();
        throw new CompiledDatasetMutationError(state);
      }
      const result = {
        affected: payload.affected,
        rowCount: payload.rowCount,
        version: payload.version,
        generation: payload.generation,
      };
      attempt.status = { ...attempt.status, state: "committed", result };
      emit();
      if (!attempt.effectsApplied) {
        attempt.effectsApplied = true;
        // A confirmed write stays committed even if a local refresh fails. Never retry it as a new write.
        try {
          const current = options.values();
          const reset = (binding.reset ?? []).filter(
            (field) =>
              Object.hasOwn(attempt.viewer, field) &&
              Object.is(current[field], attempt.viewer[field]),
          );
          if (reset.length) options.reset(reset);
        } catch {}
        try {
          await options.committed();
        } catch {}
      }
      return result;
    };
    const promise = work().finally(() => {
      attempt.promise = undefined;
    });
    attempt.promise = promise;
    return promise;
  };
  const mutate = (
    name: string,
    args: Readonly<Record<string, CompiledMutationScalar>> = {},
  ): Promise<CompiledMutationResult> => {
    try {
      const binding = bindings.get(name);
      if (
        !binding ||
        !args ||
        typeof args !== "object" ||
        Array.isArray(args) ||
        Object.keys(args).some((k) => !Object.hasOwn(binding.paramTypes, k))
      )
        throw Error("Invalid registered mutation arguments");
      const prior = attempts.get(name);
      if (prior?.status.state === "unknown")
        throw new CompiledDatasetMutationError("unknown");
      const viewer = { ...options.values() },
        params: Record<string, CompiledMutationScalar> = {};
      for (const [field, type] of Object.entries(binding.paramTypes)) {
        const value = Object.hasOwn(args, field) ? args[field] : viewer[field];
        if (!scalar(value) || !matches(type, value))
          throw Error("Invalid registered mutation arguments");
        params[field] = value;
      }
      if (prior?.status.state === "pending") {
        if (
          Object.keys(params).some(
            (field) => !Object.is(params[field], prior.params[field]),
          )
        )
          throw Error("Mutation pending with different arguments");
        return prior.promise ?? Promise.reject(Error("Mutation pending"));
      }
      const requestId = options.requestId();
      if (
        typeof requestId !== "string" ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)
      )
        throw Error("Invalid mutation request identifier");
      const attempt: Attempt = {
        status: { name, requestId, state: "pending" },
        viewer,
        params,
      };
      attempts.set(name, attempt);
      return execute(name, attempt);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return {
    mutate,
    retry(name) {
      const attempt = attempts.get(name);
      if (!attempt || attempt.status.state !== "unknown")
        return Promise.reject(Error("No unknown mutation to reconcile"));
      return execute(name, attempt);
    },
    pending(name) {
      return name
        ? attempts.get(name)?.status.state === "pending"
        : [...attempts.values()].some((a) => a.status.state === "pending");
    },
    status(name) {
      const s = attempts.get(name)?.status;
      return s
        ? { ...s, ...(s.result ? { result: { ...s.result } } : {}) }
        : null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Feed this fixed source to canonical Apollo gql; only the trusted namespace varies. */
export function compiledDatasetMutationDocument(namespace: string): string {
  if (!identifier(namespace)) throw Error("Invalid mutation namespace");
  return `mutation DatasetMutation($operation:String!,$requestId:String!,$params:DatasetParams!){${namespace}{mutate(operation:$operation,requestId:$requestId,params:$params){affected rowCount version generation}}}`;
}
