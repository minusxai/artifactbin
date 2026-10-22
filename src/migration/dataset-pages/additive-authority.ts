import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { destinationSchemas } from "../destination-schema.ts";
import { migrationDatasetTablePlans } from "../dataset-table-plans.ts";
import { canonicalMigrationValue as canonical } from "../verification-values.ts";
import type { SqlReader, LegacyRow } from "../contracts.ts";
import type { DatasetMigrationBatch } from "../dataset-destination-contracts.ts";
import type {
  StandaloneDatasetJobAdmission,
  AdditiveDatasetBaseApproval,
} from "./admission-contracts.ts";
const backendTables = {
  af_backend_files: ["file_id"],
  af_backend_versions: ["file_id", "version"],
  af_page_backends: ["page_id", "page_version", "position"],
  af_backend_pages: ["page_id"],
} as const;
const protectedTables = {
  dataset_mutation_operations: [
    "backend_id",
    "backend_version",
    "page_id",
    "page_version",
    "name",
  ],
  dataset_member_bindings: [
    "backend_id",
    "backend_version",
    "page_id",
    "page_version",
  ],
  dataset_viewer_bindings: [
    "backend_id",
    "backend_version",
    "page_id",
    "page_version",
  ],
  dataset_source_queries: ["backend_id", "backend_version", "name"],
} as const;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const additiveRowSha256 = (row: unknown) => sha(canonical(row));
export function normalizeAdditiveRow(row: LegacyRow): LegacyRow {
  const value = { ...row };
  for (const key of ["expires_at", "joined_at"])
    if (value[key] != null)
      value[key] = new Date(String(value[key])).toISOString();
  return value;
}
function same(a: unknown, b: unknown, label: string) {
  if (canonical(a) !== canonical(b))
    throw Error("Additive dataset base changed: " + label);
}
export const additiveAuthoritySha256 = (
  admission: StandaloneDatasetJobAdmission,
) =>
  additiveRowSha256({
    ...admission,
    base: {
      ...admission.base,
      verificationReport: { sha256: admission.base.verificationReport.sha256 },
    },
  });
export function additiveDatasetBatchFingerprint(
  batch: DatasetMigrationBatch,
): string {
  if (!batch.additive) throw Error("Missing additive authority");
  return additiveRowSha256({
    ...batch,
    additive: additiveAuthoritySha256(batch.additive),
  });
}
export async function validateAdditiveVerification(
  approval: AdditiveDatasetBaseApproval,
) {
  if (!approval || !/^[a-f0-9]{64}$/.test(approval.verificationReport.sha256))
    throw Error("Invalid additive base verification");
  const info = await stat(approval.verificationReport.path);
  if (!info.isFile() || info.size > 1048576)
    throw Error("Invalid additive verification file");
  const bytes = await readFile(approval.verificationReport.path);
  if (
    createHash("sha256").update(bytes).digest("hex") !==
    approval.verificationReport.sha256
  )
    throw Error("Additive verification report changed");
  const report = JSON.parse(bytes.toString("utf8"));
  if (
    report.complete !== true ||
    report.readOnly !== true ||
    report.compilerIdentity !== approval.inventory.compilerIdentity ||
    report.runtime?.pages !== approval.inventory.pageReceipts.length ||
    !Array.isArray(report.archives) ||
    !report.archives.some(
      (a: { manifestSha256?: string }) =>
        a.manifestSha256 === approval.inventory.baseManifestSha256,
    ) ||
    !report.archives.some(
      (a: { manifestSha256?: string }) =>
        a.manifestSha256 === approval.inventory.relationManifestSha256,
    )
  )
    throw Error("Incomplete or mismatched additive base verification");
}
/** Strict initial additive job: preserve every reviewed base row and allow only exact new self-page rows. */
export async function verifyAdditiveDatasetBase(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
) {
  const admission = batch.additive;
  if (!admission) throw Error("Missing additive authority");
  await validateAdditiveVerification(admission.base);
  const inventory = admission.base.inventory;
  const { runtime, archive } = destinationSchemas(schema);
  same(admission.sourceNamespace, batch.metadata.sourceNamespace, "namespace");
  same(inventory.sourceNamespace, admission.sourceNamespace, "base namespace");
  same(
    [
      batch.baseManifestSha256,
      batch.relationManifestSha256,
      batch.relationExportedAt,
    ],
    [
      inventory.baseManifestSha256,
      inventory.relationManifestSha256,
      inventory.relationExportedAt,
    ],
    "raw provenance",
  );
  const baseReceipt = (
    await db.query(
      `SELECT fingerprint FROM ${archive}.dataset_receipts WHERE source_namespace=$1`,
      [admission.sourceNamespace],
    )
  ).rows;
  same(
    baseReceipt,
    [{ fingerprint: inventory.datasetFingerprint }],
    "immutable base dataset receipt",
  );
  const pageIds = new Set(batch.metadata.pages.map((p) => p.pageId));
  const scope = new Set(admission.heads.map((h) => h.legacyId));
  const externalPages = new Map(
    (admission.external ?? []).map((e) => [e.legacyId, e]),
  );
  if (
    externalPages.size !== (admission.external ?? []).length ||
    [...externalPages.values()].some(
      (e) =>
        !admission.heads.some(
          (h) =>
            h.legacyId === e.legacyId &&
            h.version === e.version &&
            h.artifactSha256 === e.artifactSha256,
        ),
    )
  )
    throw Error("Invalid additive external scope");
  const approvedModels=admission.models??[];
  if(new Set(approvedModels.map(m=>m.legacyId)).size!==approvedModels.length||approvedModels.some(m=>!admission.heads.some(h=>h.legacyId===m.legacyId&&h.version===m.version&&h.artifactSha256===m.artifactSha256)))throw Error("Invalid additive model scope");
  for(const page of batch.metadata.pages){
    const expected=approvedModels.find(m=>m.legacyId===page.snapshot.id);
    same(page.snapshot.standaloneDataset?.models??[],expected?.attestations??[],"exact stored model admission");
  }
  const groups = batch.sourceQueryRegistrations ?? [];
  const expectedExternal = batch.metadata.pages.filter((p) =>
    externalPages.has(p.snapshot.id),
  );
  if (
    groups.length !== expectedExternal.length ||
    new Set(groups.map((g) => g.receipt.pageLegacyId)).size !== groups.length
  )
    throw Error("Incomplete additive external registrations");
  for (const group of groups) {
    const approved = externalPages.get(group.receipt.pageLegacyId);
    const page = expectedExternal.find(
      (p) => p.snapshot.id === group.receipt.pageLegacyId,
    );
    if (
      !approved ||
      !page ||
      group.receipt.pageId !== page.pageId ||
      group.receipt.pageVersion !== page.pageVersion ||
      approved.version !== page.pageVersion ||
      !/^[A-Za-z0-9]{6}$/.test(group.receipt.backendId) ||
      !/^[a-f0-9]{64}$/.test(group.receipt.deployment.version)
    )
      throw Error("Invalid additive external saved authority");
    same(group.queries, approved.queries, "external registered queries");
  }
  if (
    batch.metadata.resources.some((r) => !scope.has(r.legacyId)) ||
    batch.metadata.versions.some((v) => !scope.has(v.legacyId)) ||
    batch.metadata.profiles?.length ||
    batch.metadata.personBindings?.length ||
    batch.metadata.pages.some(
      (p) =>
        (!externalPages.has(p.snapshot.id) &&
          (p.snapshot.standaloneDataset?.datasetId !== p.snapshot.id ||
            p.snapshot.standaloneDataset.version !== p.pageVersion)) ||
        (externalPages.has(p.snapshot.id) &&
          p.snapshot.standaloneDataset !== undefined) ||
        !admission.heads.some(
          (h) => h.legacyId === p.snapshot.id && h.version === p.pageVersion,
        ),
    ) ||
    batch.ownershipDatasetGrants?.length ||
    batch.metadata.operations?.length ||
    batch.metadata.attachments?.length ||
    batch.metadata.pages.some(
      (p) =>
        p.snapshot.format !== "dataset" ||
        (!externalPages.has(p.snapshot.id) &&
          p.snapshot.standaloneDataset?.kind !== "dataset-self-read-v1") ||
        !scope.has(p.snapshot.id),
    ) ||
    batch.metadata.bindings.some(
      (b) => b.page.legacyId !== b.dataset.id || !scope.has(b.dataset.id),
    )
  )
    throw Error("Additive job may only add dataset self reads");
  if (
    inventory.reservedFileIds.some(
      (id) => !admission.reservedFileIds.includes(id),
    )
  )
    throw Error("Reserved base file ID omitted");
  const ownIds = new Set([
    ...pageIds,
    ...batch.metadata.bindings.map((b) => b.backendId),
    ...groups.map((g) => g.receipt.backendId),
  ]);
  const currentIds = (
    await db.query(`SELECT id FROM ${runtime}.file_ids`)
  ).rows.map((r) => String(r.id));
  if (
    inventory.reservedFileIds.some((id) => !currentIds.includes(id)) ||
    currentIds.some(
      (id) => !inventory.reservedFileIds.includes(id) && !ownIds.has(id),
    )
  )
    throw Error("Reserved file inventory changed");
  for (const expected of inventory.backendRows) {
    if (
      !Object.hasOwn(backendTables, expected.table) ||
      expected.key.length !== backendTables[expected.table].length
    )
      throw Error("Invalid backend inventory");
    const columns = backendTables[expected.table];
    const row = (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${expected.table} t WHERE ${columns.map((c, i) => `${c}=$${i + 1}`).join(" AND ")}`,
        [...expected.key],
      )
    ).rows[0];
    if (!row || additiveRowSha256(row.value) !== expected.sha256)
      throw Error("Base backend authority changed");
  }
  for (const expected of inventory.protectedRows) {
    if (
      !Object.hasOwn(protectedTables, expected.table) ||
      expected.key.length !== protectedTables[expected.table].length
    )
      throw Error("Invalid protected authority inventory");
    const columns = protectedTables[expected.table];
    const row = (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${expected.table} t WHERE ${columns.map((c, i) => `${c}=$${i + 1}`).join(" AND ")}`,
        [...expected.key],
      )
    ).rows[0];
    if (!row || additiveRowSha256(row.value) !== expected.sha256)
      throw Error("Base protected authority changed");
  }
  for (const expected of inventory.pageReceipts) {
    const rows = (
      await db.query(
        `SELECT key,digest,page_id FROM ${archive}.receipts WHERE key=$1`,
        [expected.key],
      )
    ).rows;
    same(
      rows,
      [
        {
          key: expected.key,
          digest: expected.digest,
          page_id: expected.pageId,
        },
      ],
      "base page receipt",
    );
    if (pageIds.has(expected.pageId))
      throw Error("Additive page already belongs to base scope");
  }
  for (const expected of inventory.sources) {
    const row = (
      await db.query(
        `SELECT f.head,s.content,row_to_json(f) AS record FROM ${runtime}.files f JOIN ${runtime}.sources s ON s.file_id=f.id AND s.revision=f.head WHERE f.id=$1`,
        [expected.pageId],
      )
    ).rows[0];
    if (
      !row ||
      String(row.head) !== expected.head ||
      sha(String(row.content)) !== expected.sha256 ||
      additiveRowSha256(row.record) !== expected.recordSha256
    )
      throw Error("Additive base source or authority changed");
  }
  if (
    inventory.sources.length !== inventory.pageReceipts.length ||
    new Set(inventory.sources.map((s) => s.pageId)).size !==
      inventory.pageReceipts.length ||
    inventory.pageReceipts.some(
      (r) => !inventory.sources.some((s) => s.pageId === r.pageId),
    )
  )
    throw Error("Incomplete base source inventory");
  const plans = migrationDatasetTablePlans(batch);
  same(
    inventory.tables.map((t) => t.table).sort(),
    plans.map((p) => p.table).sort(),
    "complete metadata inventory",
  );
  for (const plan of plans) {
    const baseline = inventory.tables.find((t) => t.table === plan.table)!;
    const expected = new Map(
      baseline.rows.map((r) => [canonical(r.key), r.sha256]),
    );
    if (expected.size !== baseline.rows.length)
      throw Error("Ambiguous additive base row");
    const own = new Map(
      plan.rows.map((r) => [
        canonical(plan.keys.map((k) => r[k])),
        additiveRowSha256(normalizeAdditiveRow(r)),
      ]),
    );
    if (plan.table === "dataset_resources")
      for (const resource of batch.metadata.resources) {
        if (expected.has(canonical([resource.legacyId]))) continue;
        const approved = admission.heads.find(
          (h) => h.legacyId === resource.legacyId,
        )?.resourceSha256;
        if (
          !approved ||
          !/^[a-f0-9]{64}$/.test(approved) ||
          additiveRowSha256(resource) !== approved
        )
          throw Error("Additive original resource descriptor not approved");
      }
    for (const [key, digest] of own)
      if (expected.has(key))
        same(
          digest,
          expected.get(key),
          plan.table + " attempted base replacement",
        );
    for (const item of (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${plan.table} t WHERE source_namespace=$1`,
        [admission.sourceNamespace],
      )
    ).rows) {
      const row = normalizeAdditiveRow(item.value as LegacyRow);
      const key = canonical(plan.keys.map((k) => row[k]));
      const digest = additiveRowSha256(row);
      if (expected.has(key)) {
        same(digest, expected.get(key), plan.table + " base row");
        expected.delete(key);
      } else if (own.get(key) !== digest)
        throw Error("Unexpected additive dataset metadata: " + plan.table);
    }
    if (expected.size)
      throw Error("Removed additive base metadata: " + plan.table);
  }
}
/** Read-only capture after a separately completed normal verifier. Freeze and review this exact result before applying. */
export async function captureAdditiveDatasetBase(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
  verificationReport: AdditiveDatasetBaseApproval["verificationReport"],
): Promise<AdditiveDatasetBaseApproval> {
  const { runtime, archive } = destinationSchemas(schema);
  const namespace = batch.metadata.sourceNamespace;
  const info = await stat(verificationReport.path);
  if (!info.isFile() || info.size > 1_048_576)
    throw Error("Invalid additive verification report size");
  const report = JSON.parse(await readFile(verificationReport.path, "utf8"));
  const receipt = (
    await db.query(
      `SELECT fingerprint FROM ${archive}.dataset_receipts WHERE source_namespace=$1`,
      [namespace],
    )
  ).rows[0];
  if (!receipt) throw Error("Base dataset import incomplete");
  const rows = (
    await db.query(
      `SELECT key,digest,page_id FROM ${archive}.receipts WHERE left(key,length($1))=$1 ORDER BY key`,
      [namespace + ":"],
    )
  ).rows;
  const inventory: AdditiveDatasetBaseApproval["inventory"] = {
    sourceNamespace: namespace,
    datasetFingerprint: String(receipt.fingerprint),
    resources: batch.metadata.resources,
    baseManifestSha256: batch.baseManifestSha256,
    relationManifestSha256: batch.relationManifestSha256,
    relationExportedAt: batch.relationExportedAt,
    compilerIdentity: report.compilerIdentity,
    reservedFileIds: (
      await db.query(`SELECT id FROM ${runtime}.file_ids ORDER BY id`)
    ).rows.map((r) => String(r.id)),
    backendRows: [],
    protectedRows: [],
    pageReceipts: rows.map((r) => ({
      key: String(r.key),
      digest: String(r.digest),
      pageId: String(r.page_id),
    })),
    sources: [],
    tables: [],
  };
  for (const [table, keys] of Object.entries(backendTables)) {
    const current = (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${table} t`,
      )
    ).rows;
    for (const r of current) {
      const row = r.value as LegacyRow;
      (
        inventory.backendRows as {
          table: keyof typeof backendTables;
          key: unknown[];
          sha256: string;
        }[]
      ).push({
        table: table as keyof typeof backendTables,
        key: keys.map((k) => row[k]),
        sha256: additiveRowSha256(row),
      });
    }
  }
  for (const [table, keys] of Object.entries(protectedTables)) {
    const predicate =
      table === "dataset_source_queries"
        ? "registration->>'sourceNamespace'=$1"
        : "source_namespace=$1";
    for (const r of (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${table} t WHERE ${predicate}`,
        [namespace],
      )
    ).rows) {
      const row = r.value as LegacyRow;
      (
        inventory.protectedRows as {
          table: keyof typeof protectedTables;
          key: unknown[];
          sha256: string;
        }[]
      ).push({
        table: table as keyof typeof protectedTables,
        key: keys.map((k) => row[k]),
        sha256: additiveRowSha256(row),
      });
    }
  }
  for (const r of inventory.pageReceipts) {
    const row = (
      await db.query(
        `SELECT f.head,s.content,row_to_json(f) AS record FROM ${runtime}.files f JOIN ${runtime}.sources s ON s.file_id=f.id AND s.revision=f.head WHERE f.id=$1`,
        [r.pageId],
      )
    ).rows[0];
    if (!row) throw Error("Missing base source");
    (
      inventory.sources as {
        pageId: string;
        head: string;
        sha256: string;
        recordSha256: string;
      }[]
    ).push({
      pageId: r.pageId,
      head: String(row.head),
      sha256: sha(String(row.content)),
      recordSha256: additiveRowSha256(row.record),
    });
  }
  for (const p of migrationDatasetTablePlans(batch)) {
    const current = (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${p.table} t WHERE source_namespace=$1`,
        [namespace],
      )
    ).rows;
    (
      inventory.tables as {
        table: string;
        rows: { key: unknown[]; sha256: string }[];
      }[]
    ).push({
      table: p.table,
      rows: current.map((r) => {
        const row = normalizeAdditiveRow(r.value as LegacyRow);
        return {
          key: p.keys.map((k) => row[k]),
          sha256: additiveRowSha256(row),
        };
      }),
    });
  }
  const approval = { verificationReport, inventory };
  await validateAdditiveVerification(approval);
  return approval;
}
