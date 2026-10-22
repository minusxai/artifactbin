import { createRequire } from "node:module";
import type { PgPool } from "../../connectors/contracts.ts";
const pg = createRequire(import.meta.url)("pg");
/** Operator-only static resource allowlist. SSL verification cannot be weakened by URL options. */
export function createSourceQueryResources(
  json: string,
  env: Record<string, string | undefined>,
  poolFactory: (
    options: Record<string, unknown>,
  ) => PgPool & { on(event: string, listener: () => void): void } = (options) =>
    new pg.Pool(options),
) {
  if (json.length > 65536) throw Error("Invalid source query resources");
  const value = JSON.parse(json);
  const pools = new Map<string, PgPool>();
  try {
    if (
      !value ||
      Object.keys(value).join() !== "resources" ||
      !value.resources ||
      Array.isArray(value.resources) ||
      Object.keys(value.resources).length > 128
    )
      throw Error();
    for (const [name, raw] of Object.entries(value.resources)) {
      const r = raw as any;
      if (
        !/^source-[A-Za-z0-9]{6,128}$/.test(name) ||
        !r ||
        Object.keys(r).sort().join(",") !== "caEnv,connectionStringEnv" ||
        ![r.caEnv, r.connectionStringEnv].every(
          (k) =>
            typeof k === "string" &&
            /^PAGEGI_SOURCE_QUERY_[A-Z0-9_]+$/.test(k) &&
            env[k],
        )
      )
        throw Error();
      const url = new URL(env[r.connectionStringEnv]!);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw Error();
      for (const k of [...url.searchParams.keys()])
        if (k.toLowerCase().startsWith("ssl")) url.searchParams.delete(k);
      const pool = poolFactory({
        connectionString: url.href,
        ssl: { ca: env[r.caEnv], rejectUnauthorized: true },
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
        query_timeout: 5500,
        options: "-c default_transaction_read_only=on",
        types: {
          getTypeParser: (oid: number, format: string) =>
            [1082, 1114, 1184].includes(oid)
              ? (v: string) => v
              : pg.types.getTypeParser(oid, format),
        },
      });
      pool.on("error", () => {});
      pools.set(name, pool);
    }
  } catch {
    for (const pool of pools.values()) void pool.end().catch(() => {});
    throw Error("Invalid source query resources");
  }
  let closing: Promise<void> | undefined;
  return {
    pool: (resource: string) => pools.get(resource),
    close: () =>
      (closing ??= Promise.all([...pools.values()].map((p) => p.end())).then(
        () => {},
      )),
  };
}
