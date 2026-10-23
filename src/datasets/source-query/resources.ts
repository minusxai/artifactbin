import { createRequire } from "node:module";
import type { PgPool } from "../../connectors/contracts.ts";
const pg = createRequire(import.meta.url)("pg");
/** Text dates stay date-only. Timestamp-without-zone is a UTC instant;
 * zoned timestamps retain their instant as canonical ISO UTC. Match legacy:
 * malformed/unbounded 1114 stays raw; invalid/nonfinite 1184 becomes null.
 * PostgreSQL NULL bypasses the parser and remains null.
 */
export interface SourceQueryTypeParsers {
  getTypeParser(oid: number, format: string): (value: string) => unknown;
}
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
      const keys = r && Object.keys(r).sort().join(",");
      const systemRoots =
        keys === "ca,connectionStringEnv" && r.ca === "system-default-roots";
      const privateEnv = (key: unknown) =>
        typeof key === "string" &&
        /^PAGEGI_SOURCE_QUERY_[A-Z0-9_]+$/.test(key) &&
        !!env[key];
      if (
        !/^source-[A-Za-z0-9]{6,128}$/.test(name) ||
        !r ||
        !privateEnv(r.connectionStringEnv) ||
        (!systemRoots &&
          (keys !== "caEnv,connectionStringEnv" || !privateEnv(r.caEnv)))
      )
        throw Error();
      const url = new URL(env[r.connectionStringEnv]!);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw Error();
      for (const k of [...url.searchParams.keys()])
        if (k.toLowerCase().startsWith("ssl")) url.searchParams.delete(k);
      const types: SourceQueryTypeParsers = {
        getTypeParser(oid, format) {
          if (format !== "binary" && oid === 1082) return (value) => value;
          if (format !== "binary" && oid === 1114)
            return (value) => {
              const date = new Date(`${value}Z`);
              return Number.isNaN(date.getTime()) ? value : date.toISOString();
            };
          const parse = pg.types.getTypeParser(oid, format);
          if (format !== "binary" && oid === 1184)
            return (value) => {
              const parsed = parse(value);
              if (parsed instanceof Date) return parsed.toISOString();
              return typeof parsed === "number" && !Number.isFinite(parsed)
                ? null
                : parsed;
            };
          return parse;
        },
      };
      const pool = poolFactory({
        connectionString: url.href,
        ssl: systemRoots
          ? { rejectUnauthorized: true }
          : { ca: env[r.caEnv], rejectUnauthorized: true },
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
        query_timeout: 5500,
        options: "-c default_transaction_read_only=on",
        types,
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
