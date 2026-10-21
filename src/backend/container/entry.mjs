import * as backend from "./backend.js";
const NOT_JSON =
  "Values must be plain JSON: no cycles, functions, class instances, undefined or non-finite numbers";
function validate(x, seen = new Set(), depth = 0) {
  if (depth > 64) throw Error("Values nest at most 64 levels deep");
  if (
    x === null ||
    typeof x === "string" ||
    typeof x === "boolean" ||
    (typeof x === "number" && Number.isFinite(x))
  )
    return;
  if (
    typeof x !== "object" ||
    seen.has(x) ||
    (!Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype)
  )
    throw Error(NOT_JSON);
  seen.add(x);
  const keys = Reflect.ownKeys(x),
    array = Array.isArray(x);
  if (array && keys.length !== x.length + 1) throw Error("Arrays must have no holes");
  for (const key of keys) {
    if (array && key === "length") continue;
    const d = Object.getOwnPropertyDescriptor(x, key);
    if (
      typeof key !== "string" ||
      !d.enumerable ||
      !("value" in d) ||
      (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= x.length))
    )
      throw Error(NOT_JSON);
    validate(d.value, seen, depth + 1);
  }
  seen.delete(x);
}
/** What was thrown, as the host will show it to the page owner: one line, at most 200 characters. */
function detailOf(error) {
  try {
    const text = typeof error === "string" ? error : error?.message;
    if (typeof text !== "string") return undefined;
    const line = text.split(/\r?\n/, 1)[0].trim().slice(0, 200);
    return line || undefined;
  } catch {
    return undefined;
  }
}
/** The platform keeps a store document to 60 KB of JSON; checked here first so the message is the same either way. */
const STORE_LIMIT_BYTES = 60 * 1024;
/** Store-limit errors this module threw: a resolver can set `code` on anything, but not join this set. */
const storeLimitErrors = new WeakSet();
function storeLimitError() {
  const error = Error(
    "The store document is limited to 60 KB of JSON; nothing was saved",
  );
  error.code = "store_limit";
  storeLimitErrors.add(error);
  return error;
}
function codeOf(error) {
  return typeof error === "object" && error !== null && storeLimitErrors.has(error)
    ? "store_limit"
    : "backend_rejected";
}
export default {
  async fetch(req, env) {
    try {
      const request = await req.json();
      // Every binding but the capability bridge is one of the owner's secrets.
      const { pagegi_capability: capabilityService, ...secrets } = env;
      let value;
      const resolvers = Object.create(null);
      const groups = backend.default;
      if (
        !groups ||
        Object.keys(groups).some((k) => k !== "Query" && k !== "Mutation")
      )
        throw Error("The default export must be an object with Query and/or Mutation");
      for (const group of Object.values(groups)) {
        if (!group || typeof group !== "object")
          throw Error("Query and Mutation must be objects of resolver functions");
        for (const [field, resolver] of Object.entries(group)) {
          if (typeof resolver !== "function" || Object.hasOwn(resolvers, field))
            throw Error(`Resolver ${field} must be one function`);
          resolvers[field] = resolver;
        }
      }
      if (request.kind === "compile") {
        value = {
          typeDefs: backend.typeDefs,
          fields: Object.keys(resolvers),
          roots: {
            Query: Object.keys(groups.Query ?? {}),
            Mutation: Object.keys(groups.Mutation ?? {}),
          },
        };
      } else {
        if (!Object.hasOwn(resolvers, request.input.field))
          throw Error(`No resolver for ${request.input.field}`);
        let calls = 0,
          pending = 0,
          bytes = 0;
        const capability = async (request) => {
          validate(request);
          const body = JSON.stringify(request);
          bytes += new TextEncoder().encode(body).byteLength;
          if (
            ++calls > 100 ||
            pending >= 8 ||
            bytes > 1048576 ||
            new TextEncoder().encode(body).byteLength > 65536
          )
            throw Error("capability quota");
          pending++;
          try {
            const result = await capabilityService.fetch("http://capability/", {
              method: "POST",
              body,
            });
            const reply = await result.json();
            // A store write over the size limit is the one refusal named by code; resolvers may catch it.
            if (!reply.ok)
              throw reply.code === "store_limit"
                ? storeLimitError()
                : Error("capability rejected");
            validate(reply.value);
            return reply.value;
          } finally {
            pending--;
          }
        };
        value = await resolvers[request.input.field](
          request.input.args,
          Object.freeze(request.principal),
          Object.freeze({
            invoke: async (req) => {
              validate(req);
              if (
                !req ||
                Object.keys(req).sort().join() !== "input,operation,resource"
              )
                throw Error("capability request");
              return capability({ kind: "invoke", ...req });
            },
            transaction: async (resource, operations) =>
              capability({ kind: "transaction", resource, operations }),
            // This backend file's one JSON document, kept by the platform.
            store: Object.freeze({
              get: async () => {
                const reply = await capability({
                  kind: "store",
                  operation: "get",
                });
                return { value: reply.value, version: reply.version };
              },
              set: async (value, options) => {
                const expected = options?.expected;
                if (!Number.isSafeInteger(expected) || expected < 0)
                  throw TypeError(
                    "caps.store.set needs { expected: <the version you read> }",
                  );
                validate(value);
                if (
                  new TextEncoder().encode(JSON.stringify(value)).byteLength >
                  STORE_LIMIT_BYTES
                )
                  throw storeLimitError();
                const reply = await capability({
                  kind: "store",
                  operation: "set",
                  value,
                  expected,
                });
                if (reply.conflict === true) {
                  const conflict = Error(
                    "The store changed since you read it; read it again and retry",
                  );
                  conflict.name = "StoreConflict";
                  conflict.code = "conflict";
                  conflict.version = reply.version;
                  throw conflict;
                }
                return reply.version;
              },
            }),
          }),
          Object.freeze(secrets),
        );
      }
      validate(value);
      const encoded = JSON.stringify(value);
      if (new TextEncoder().encode(encoded).byteLength > 65536)
        return Response.json({ ok: false, code: "output_quota" });
      return new Response(
        JSON.stringify({ ok: true, value: JSON.parse(encoded) }),
      );
    } catch (error) {
      const message = detailOf(error);
      return Response.json({
        ok: false,
        code: codeOf(error),
        ...(message === undefined ? {} : { message }),
      });
    }
  },
};
