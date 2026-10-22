import { createHash } from "node:crypto";
import {
  captureAdditiveDatasetBase,
  additiveRowSha256,
  validateAdditiveVerification,
} from "../dataset-pages/additive-authority.ts";
import { destinationSchemas } from "../destination-schema.ts";
import { verifyMigrationRuntime } from "../page-verification.ts";
import { migrationPageDigest } from "../import.ts";
import type { SqlReader, PlannedPage, MigrationMaps } from "../contracts.ts";
import type {
  StandaloneVizJobAdmission,
  StandaloneVizBaseInputs,
} from "./admission-contracts.ts";
export const vizAuthoritySha256 = (admission: StandaloneVizJobAdmission) =>
  additiveRowSha256({
    ...admission,
    base: {
      ...admission.base,
      verificationReport: { sha256: admission.base.verificationReport.sha256 },
    },
  });
/** Replays admit only exact normal importer receipts and independently verified saved content. */
export async function verifyStandaloneVizBase(
  db: SqlReader,
  schema: string,
  admission: StandaloneVizJobAdmission,
  inputs: StandaloneVizBaseInputs,
  pages: readonly PlannedPage[],
  maps: MigrationMaps,
  origin: string,
) {
  await validateAdditiveVerification(admission.base);
  const { runtime, archive } = destinationSchemas(schema),
    own = new Set(admission.heads.map((h) => h.pageId));
  if (
    admission.sourceNamespace !== inputs.batch.metadata.sourceNamespace ||
    admission.base.inventory.sourceNamespace !== admission.sourceNamespace ||
    admission.base.inventory.reservedFileIds.some((id) => own.has(id)) ||
    pages.length !== own.size ||
    pages.some(
      (p) => !own.has(p.pageId) || p.backends?.length || p.assets?.length,
    )
  )
    throw Error("Invalid visualization additive authority");
  const existing: PlannedPage[] = [];
  for (const page of pages) {
    const receipts = (
      await db.query(
        `SELECT key,digest,page_id FROM ${archive}.receipts WHERE page_id=$1`,
        [page.pageId],
      )
    ).rows;
    const files = (
      await db.query(`SELECT id FROM ${runtime}.file_ids WHERE id=$1`, [
        page.pageId,
      ])
    ).rows;
    if (!receipts.length && !files.length) continue;
    if (
      receipts.length !== 1 ||
      files.length !== 1 ||
      receipts[0]!.key !== admission.sourceNamespace + ":" + page.legacyId ||
      receipts[0]!.digest !== migrationPageDigest(page) ||
      receipts[0]!.page_id !== page.pageId
    )
      throw Error("Visualization destination is already occupied or changed");
    existing.push(page);
  }
  if (existing.length)
    await verifyMigrationRuntime(db, schema, {
      pages: (async function* () {
        yield* existing;
      })(),
      maps: {
        ...maps,
        pages: Object.fromEntries(existing.map((p) => [p.legacyId, p.pageId])),
      },
      origin,
    });
  // The only rows removed from base capture are the exact own pages verified immediately above.
  // Unknown receipts/IDs remain visible and cause the complete baseline comparison to fail.
  const baseReader: SqlReader = {
    query: async (sql, values) => {
      const result = await db.query(sql, values);
      if (sql === `SELECT id FROM ${runtime}.file_ids ORDER BY id`)
        return { rows: result.rows.filter((r) => !own.has(String(r.id))) };
      if (
        sql ===
        `SELECT key,digest,page_id FROM ${archive}.receipts WHERE left(key,length($1))=$1 ORDER BY key`
      )
        return { rows: result.rows.filter((r) => !own.has(String(r.page_id))) };
      return result;
    },
  };
  const captured = await captureAdditiveDatasetBase(
    baseReader,
    schema,
    inputs.batch,
    admission.base.verificationReport,
  );
  if (
    additiveRowSha256(captured.inventory) !==
    additiveRowSha256(admission.base.inventory)
  )
    throw Error(
      "Completed base facts changed before visualization publication",
    );
}
function vizReceipt(
  admission: StandaloneVizJobAdmission,
  pages: readonly PlannedPage[],
) {
  const authority = vizAuthoritySha256(admission);
  const receipt = {
    kind: admission.kind,
    authoritySha256: authority,
    sourceNamespace: admission.sourceNamespace,
    pages: pages.map((p) => ({
      pageId: p.pageId,
      sourceVersions: p.revisions.map((r) => r.version),
      digest: migrationPageDigest(p),
    })),
  };
  return {
    authority,
    receipt,
    digest: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
  };
}
export async function verifyStandaloneVizReceipt(
  db: SqlReader,
  schema: string,
  admission: StandaloneVizJobAdmission,
  pages: readonly PlannedPage[],
) {
  const { archive } = destinationSchemas(schema),
    expected = vizReceipt(admission, pages);
  const rows = (
    await db.query(
      `SELECT digest,receipt FROM ${archive}.viz_additive_receipts WHERE source_namespace=$1 AND authority_sha256=$2`,
      [admission.sourceNamespace, expected.authority],
    )
  ).rows;
  if (
    rows.length !== 1 ||
    rows[0]!.digest !== expected.digest ||
    additiveRowSha256(rows[0]!.receipt) !== additiveRowSha256(expected.receipt)
  )
    throw Error("Visualization additive receipt missing or changed");
}
export async function recordStandaloneVizReceipt(
  db: SqlReader,
  schema: string,
  admission: StandaloneVizJobAdmission,
  pages: readonly PlannedPage[],
) {
  const { archive } = destinationSchemas(schema),
    { authority, receipt, digest } = vizReceipt(admission, pages);
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${archive}.viz_additive_receipts(source_namespace text NOT NULL,authority_sha256 text NOT NULL,digest text NOT NULL,receipt jsonb NOT NULL,PRIMARY KEY(source_namespace,authority_sha256))`,
  );
  const old = (
    await db.query(
      `SELECT digest FROM ${archive}.viz_additive_receipts WHERE source_namespace=$1 AND authority_sha256=$2`,
      [admission.sourceNamespace, authority],
    )
  ).rows;
  if (old.length && old[0]!.digest !== digest)
    throw Error("Visualization additive receipt changed");
  await db.query(
    `INSERT INTO ${archive}.viz_additive_receipts VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(source_namespace,authority_sha256) DO NOTHING`,
    [admission.sourceNamespace, authority, digest, JSON.stringify(receipt)],
  );
  await verifyStandaloneVizReceipt(db, schema, admission, pages);
}
