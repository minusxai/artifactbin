import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const pg = createRequire(import.meta.url)("pg");
import { createConnectorHost } from "./index.ts";
import { destination } from "./http.ts";
import type { ConnectorBinding, Json } from "./contracts.ts";
import type {
  ConfiguredResources,
  ResourceConfiguration,
  ResourceConfigOptions,
  ParameterSelector,
} from "./config-contracts.ts";
const invalid = (): never => {
  throw new Error("Invalid resource configuration");
};
const forbidden = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "valueOf",
]);
function name(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.:-]{1,200}$/.test(value) ||
    forbidden.has(value)
  )
    invalid();
}
function object(value: unknown): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
}
function keys(value: Record<string, any>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k))) invalid();
}
function secret(env: Record<string, string | undefined>, key: unknown): string {
  if (typeof key !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(key) || !env[key])
    return invalid();
  return env[key]!;
}
function select(
  selector: ParameterSelector,
  tenant: string,
  subject: string,
  input: Json,
): Json {
  if (selector.from === "tenant") return tenant;
  if (selector.from === "subject") return subject;
  let value: Json = input;
  for (const key of (
    selector as { from: "input"; path: readonly (string | number)[] }
  ).path) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      return null;
    value = (value as any)[key];
  }
  return value;
}
/** Deployment-owned JSON only: no evaluated parameter functions or app-selected bindings. */
export function configureResources(
  value: unknown,
  options: ResourceConfigOptions = {},
): ConfiguredResources {
  // Copy first so later caller mutations cannot change validated authority or selectors.
  try {
    value = JSON.parse(JSON.stringify(value));
  } catch {
    invalid();
  }
  object(value);
  keys(value, ["resources", "grants"]);
  object(value.resources);
  if (!Array.isArray(value.grants)) invalid();
  const config = value as unknown as ResourceConfiguration,
    env = options.env ?? process.env;
  // Validate everything before allocating any pools.
  for (const [resource, b] of Object.entries(config.resources)) {
    name(resource);
    object(b);
    object(b.operations);
    if (b.kind === "http") {
      keys(b, ["kind", "origin", "tokenEnv", "operations"]);
      secret(env, b.tokenEnv);
      for (const [operation, op] of Object.entries(b.operations)) {
        name(operation);
        object(op);
        keys(op, ["path", "method"]);
        if (typeof op.path !== "string") invalid();
        try {
          destination(
            { ...b, token: "" },
            op,
            options.allowLoopbackHttp ?? false,
          );
        } catch {
          invalid();
        }
      }
    } else if (b.kind === "postgres") {
      keys(b, ["kind", "connectionStringEnv", "operations"]);
      secret(env, b.connectionStringEnv);
      for (const [operation, op] of Object.entries(b.operations)) {
        name(operation);
        object(op);
        keys(op, ["text", "params"]);
        if (
          typeof op.text !== "string" ||
          !op.text.trim() ||
          !Array.isArray(op.params)
        )
          invalid();
        for (const s of op.params) {
          object(s);
          if (s.from === "tenant" || s.from === "subject") keys(s, ["from"]);
          else if (s.from === "input") {
            keys(s, ["from", "path"]);
            if (
              !Array.isArray(s.path) ||
              s.path.some((k) =>
                typeof k === "string"
                  ? forbidden.has(k)
                  : !Number.isSafeInteger(k) || k < 0,
              )
            )
              invalid();
          } else invalid();
        }
      }
    } else invalid();
  }
  for (const g of config.grants) {
    object(g);
    keys(g, ["documentId", "backendVersion", "resource", "namedOperations"]);
    name(g.documentId);
    name(g.resource);
    if (
      typeof g.backendVersion !== "string" ||
      !/^[a-f0-9]{64}$/.test(g.backendVersion) ||
      !Array.isArray(g.namedOperations) ||
      !g.namedOperations.length ||
      !Object.hasOwn(config.resources, g.resource)
    )
      invalid();
    for (const operation of g.namedOperations) {
      name(operation);
      if (!Object.hasOwn(config.resources[g.resource]!.operations, operation))
        invalid();
    }
    Object.freeze(g.namedOperations);
    Object.freeze(g);
  }
  const bindings: Record<string, ConnectorBinding> = Object.create(null);
  try {
    for (const [resource, b] of Object.entries(config.resources)) {
      if (b.kind === "http")
        bindings[resource] = { ...b, token: secret(env, b.tokenEnv) };
      else {
        const factory =
          options.poolFactory ?? ((settings) => new pg.Pool(settings));
        const pool = factory({
          connectionString: secret(env, b.connectionStringEnv),
          max: 8,
          connectionTimeoutMillis: 1000,
          idleTimeoutMillis: 30000,
          statement_timeout: 1000,
          query_timeout: 1200,
        });
        // pg removes failed idle clients itself. Consume its pool-level error event
        // without logging provider messages, which can contain connection secrets.
        // Keep the listener through pool.end(): disconnects can race shutdown.
        pool.on?.("error", () => {});
        bindings[resource] = {
          kind: "postgres",
          pool,
          operations: Object.fromEntries(
            Object.entries(b.operations).map(([n, op]) => [
              n,
              {
                text: op.text,
                params: (caller, input) =>
                  op.params.map((s) =>
                    select(s, caller.tenant, caller.subject, input),
                  ),
              },
            ]),
          ),
        };
      }
    }
  } catch {
    for (const binding of Object.values(bindings)) {
      if (binding.kind === "postgres") void binding.pool.end().catch(() => {});
    }
    return invalid();
  }
  return {
    host: createConnectorHost(bindings, {
      allowLoopbackHttp: options.allowLoopbackHttp,
    }),
    grants: Object.freeze(config.grants),
  };
}
export function loadResourceConfiguration(
  path: string,
  options: ResourceConfigOptions = {},
): ConfiguredResources {
  let value: unknown;
  try {
    const source = readFileSync(path, "utf8");
    if (Buffer.byteLength(source) > 1024 * 1024) invalid();
    value = JSON.parse(source);
  } catch {
    return invalid();
  }
  return configureResources(value, options);
}
