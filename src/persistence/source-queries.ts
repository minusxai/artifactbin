import type { SqlClient, SqlDatabase } from "./sql-contracts.ts";
import type {
  SourceQueryPorts,
  SourceQueryRegistration,
  MigrationSourceQueryRegistration,
} from "../datasets/source-query/contracts.ts";
import { validateSourceRegistration } from "../datasets/source-query/sql.ts";
import { loadDatasetViewer } from "./dataset-viewer.ts";
import type { PgPool } from "../connectors/contracts.ts";
export interface SourceQueryBackendReceipt {
  pageLegacyId: string;
  pageId: string;
  pageVersion: number;
  backendId: string;
  deployment: { version: string };
}
/** Called in the migration registration transaction, only after canonical backend receipt registration. */
export async function registerSourceQueries(
  db: Pick<SqlClient, "query">,
  receipt: SourceQueryBackendReceipt,
  sourceNamespace: string,
  queries: readonly MigrationSourceQueryRegistration[],
): Promise<void> {
  for (const query of queries) {
    validateSourceRegistration(query);
    if (
      query.pageLegacyId !== receipt.pageLegacyId ||
      query.pageVersion !== receipt.pageVersion
    )
      throw Error("Source query receipt mismatch");
    const registration: SourceQueryRegistration = {
      ...query,
      backendId: receipt.backendId,
      backendVersion: receipt.deployment.version,
      pageId: receipt.pageId,
      sourceNamespace,
    };
    const rows = (
      await db.query(
        `INSERT INTO dataset_source_queries(backend_id,backend_version,page_id,page_version,name,registration) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING name`,
        [
          registration.backendId,
          registration.backendVersion,
          registration.pageId,
          registration.pageVersion,
          registration.name,
          JSON.stringify(registration),
        ],
      )
    ).rows;
    if (!rows.length) {
      const old = (
        await db.query(
          "SELECT registration=$4::jsonb AS matches FROM dataset_source_queries WHERE backend_id=$1 AND backend_version=$2 AND name=$3",
          [
            registration.backendId,
            registration.backendVersion,
            registration.name,
            JSON.stringify(registration),
          ],
        )
      ).rows;
      if (old.length !== 1 || old[0]!.matches !== true)
        throw Error("Source query registration conflict");
    }
  }
}
/** Replay is verification-only: removed, added or changed operations cannot be recreated by retry. */
export async function verifySourceQueries(
  db: Pick<SqlClient, "query">,
  receipt: SourceQueryBackendReceipt,
  sourceNamespace: string,
  queries: readonly MigrationSourceQueryRegistration[],
): Promise<void> {
  const names = new Set(queries.map((q) => q.name));
  if (names.size !== queries.length)
    throw Error("Source query registration conflict");
  const count = (
    await db.query(
      "SELECT count(*)::integer AS count FROM dataset_source_queries WHERE backend_id=$1 AND backend_version=$2",
      [receipt.backendId, receipt.deployment.version],
    )
  ).rows;
  if (count.length !== 1 || count[0]!.count !== queries.length)
    throw Error("Source query registration conflict");
  for (const query of queries) {
    validateSourceRegistration(query);
    if (
      query.pageLegacyId !== receipt.pageLegacyId ||
      query.pageVersion !== receipt.pageVersion
    )
      throw Error("Source query receipt mismatch");
    const registration: SourceQueryRegistration = {
      ...query,
      backendId: receipt.backendId,
      backendVersion: receipt.deployment.version,
      pageId: receipt.pageId,
      sourceNamespace,
    };
    const rows = (
      await db.query(
        "SELECT registration=$4::jsonb AS matches FROM dataset_source_queries WHERE backend_id=$1 AND backend_version=$2 AND name=$3",
        [
          receipt.backendId,
          receipt.deployment.version,
          query.name,
          JSON.stringify(registration),
        ],
      )
    ).rows;
    if (rows.length !== 1 || rows[0]!.matches !== true)
      throw Error("Source query registration conflict");
  }
}
export function createSourceQueryRepository(
  database: SqlDatabase,
  pool: (resource: string) => PgPool | undefined,
  now = Date.now,
): SourceQueryPorts {
  return {
    pool,
    registry: (context, name, signal) =>
      database.transaction(
        async (client) => {
          const rows = (
            await client.query(
              `SELECT q.registration FROM dataset_source_queries q WHERE q.backend_id=$1 AND q.backend_version=$2 AND q.page_id=$3 AND q.name=$4 AND EXISTS(SELECT 1 FROM af_page_backends p WHERE p.page_id=q.page_id AND p.page_version=q.page_version AND p.file_id=q.backend_id AND p.version=q.backend_version)`,
              [context.backendId, context.backendVersion, context.pageId, name],
            )
          ).rows;
          return rows.length === 1
            ? (rows[0]!.registration as SourceQueryRegistration)
            : null;
        },
        { signal, timeoutMs: 1000 },
      ),
    authority: (context, signal) =>
      database.transaction(
        async (client) => {
          const value = await loadDatasetViewer(client, context, now());
          return value
            ? {
                generation: value.generation,
                userId: value.id,
                now: new Date(now()).toISOString(),
                tz: "UTC",
              }
            : null;
        },
        { signal, timeoutMs: 1000 },
      ),
  };
}
