import type {
  BackendCapabilityHandler,
  BackendJson,
} from "../backend/contracts.ts";
import type { ProgramInvocationAuthority } from "./runtime-contracts.ts";
import type { AuthorState, Row } from "../author/contracts.ts";
import { assertStorable } from "../apollo/storable.ts";
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every(
    (key) => required.includes(key) || optional.includes(key),
  );
const scalar = (value: unknown) =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const row = (value: unknown): value is Row =>
  record(value) && Object.values(value).every(scalar);
/** One handler per invocation. The sandbox selects neither authority nor a database resource.
 * This is intentionally unwired until its trusted page query/mutation service adapter is supplied.
 */
export function programCapabilityHandler(
  authority: ProgramInvocationAuthority,
): BackendCapabilityHandler {
  const principal = Object.freeze({ ...authority.principal });
  const names = {
    values: [...authority.manifest.values],
    queries: [
      ...authority.manifest.queries,
      ...(authority.manifest.tables ?? []),
    ],
    mutations: [...authority.manifest.mutations],
  };
  const writes = new Map<
    string,
    { input: string; result: Promise<BackendJson> }
  >();
  if (!authority.requestId) throw Error("Program request identity required");
  return async (caller, request, signal) => {
    if (signal?.aborted) throw Error("Program cancelled");
    if (
      caller.tenant !== principal.tenant ||
      caller.subject !== principal.subject ||
      request.kind !== "invoke" ||
      request.resource !== "program-bindings" ||
      !record(request.input)
    )
      throw Error("Program capability denied");
    const input = request.input;
    assertStorable(input);
    if (new TextEncoder().encode(JSON.stringify(input)).length > 65536)
      throw Error("Program capability denied");
    const abort = signal ?? new AbortController().signal;
    await authority.transport.authorize(abort);
    if (signal?.aborted) throw Error("Program cancelled");
    if (request.operation === "authorize") {
      if (Object.keys(input).length) throw Error("Program capability denied");
      return null;
    }
    if (
      !row(input.values) ||
      Object.keys(input.values).length !== names.values.length ||
      !names.values.every((name) => Object.hasOwn(input.values as object, name))
    )
      throw Error("Program capability denied");
    const values = structuredClone(input.values) as Record<string, AuthorState>;
    if (request.operation === "query") {
      if (
        !keys(input, ["name", "values"]) ||
        typeof input.name !== "string" ||
        !names.queries.includes(input.name)
      )
        throw Error("Program capability denied");
      const result = await authority.transport.query(input.name, values, abort);
      await authority.transport.authorize(abort);
      if (abort.aborted) throw Error("Program cancelled");
      assertStorable(result);
      return result;
    }
    if (
      request.operation !== "mutate" ||
      !keys(input, ["name", "args", "operationId", "values"], ["row"]) ||
      typeof input.name !== "string" ||
      !names.mutations.includes(input.name) ||
      !row(input.args) ||
      (input.row !== undefined && !row(input.row)) ||
      typeof input.operationId !== "string" ||
      !/^operation-[1-9][0-9]{0,8}$/.test(input.operationId)
    )
      throw Error("Program capability denied");
    const identity = authority.requestId + ":" + input.operationId;
    const serialized = JSON.stringify(input);
    const previous = writes.get(identity);
    if (previous) {
      if (previous.input !== serialized)
        throw Error("Program operation identity conflict");
      return previous.result;
    }
    const result = Promise.resolve()
      .then(() =>
        authority.transport.mutate(
          input.name as string,
          structuredClone(input.args as Row),
          input.row === undefined
            ? undefined
            : structuredClone(input.row as Row),
          identity,
          values,
          abort,
        ),
      )
      .then(() => null);
    writes.set(identity, { input: serialized, result });
    return result;
  };
}
