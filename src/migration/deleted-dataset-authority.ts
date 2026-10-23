import type { DatasetMigrationBatch } from "./dataset-destination-contracts.ts";
import type { DeletedDatasetAuthority } from "./deleted-dataset-authority-contracts.ts";
import type { LegacyRow, SqlReader } from "./contracts.ts";
import {
  additiveRowSha256 as hash,
  normalizeAdditiveRow,
  validateAdditiveVerification,
} from "./dataset-pages/additive-authority.ts";
import {
  canonicalMigrationValue as canonical,
  requireMigrationEquality as equal,
} from "./verification-values.ts";
import { migrationDatasetTablePlans } from "./dataset-table-plans.ts";
import { destinationSchemas } from "./destination-schema.ts";
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
/** ACL revisions have independent source/runtime clocks; preserve each clock in its own record. */
function semanticAccess(value: unknown) {
  const access = value as {
    visibility?: unknown;
    linkRole?: unknown;
    shares?: unknown;
  } | null;
  return {
    visibility: access?.visibility,
    linkRole: access?.linkRole,
    shares: access?.shares,
  };
}
export function deletedDatasetBatchFingerprint(
  batch: DatasetMigrationBatch,
): string {
  const { deletedAdditive: _, ...payload } = batch;
  return hash(payload);
}
export function deletedDatasetAuthoritySha256(
  authority: DeletedDatasetAuthority,
): string {
  return hash({
    ...authority,
    base: {
      ...authority.base,
      verificationReport: { sha256: authority.base.verificationReport.sha256 },
    },
  });
}
export function validateDeletedDatasetBatch(
  batch: DatasetMigrationBatch,
): DeletedDatasetAuthority {
  const a = batch.deletedAdditive;
  if (
    !a ||
    batch.additive ||
    a.kind !== "deleted-dataset-additive-v1" ||
    a.sourceNamespace !== batch.metadata.sourceNamespace ||
    a.base.inventory.sourceNamespace !== a.sourceNamespace ||
    !/^[a-f0-9]{64}$/.test(a.batchSha256) ||
    a.batchSha256 !== deletedDatasetBatchFingerprint(batch) ||
    !a.admitted.length
  )
    throw Error("Invalid sealed deleted dataset authority");
  equal(
    [
      batch.baseManifestSha256,
      batch.relationManifestSha256,
      batch.relationExportedAt,
    ],
    [
      a.base.inventory.baseManifestSha256,
      a.base.inventory.relationManifestSha256,
      a.base.inventory.relationExportedAt,
    ],
    "deleted dataset provenance",
  );
  const ids = new Set<string>();
  const pages = new Set<string>();
  const tuples = new Set<string>();
  for (const entry of a.admitted) {
    const key = canonical([entry.pageId, entry.version]);
    if (
      !entry.legacyId ||
      !entry.pageId ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1 ||
      !/^[a-f0-9]{64}$/.test(entry.artifactSha256) ||
      tuples.has(key)
    )
      throw Error("Invalid deleted dataset admitted scope");
    if (
      a.admitted.some(
        (e) =>
          (e.pageId === entry.pageId && e.legacyId !== entry.legacyId) ||
          (e.legacyId === entry.legacyId && e.pageId !== entry.pageId),
      )
    )
      throw Error("Ambiguous deleted dataset identity");
    tuples.add(key);
    ids.add(entry.legacyId);
    pages.add(entry.pageId);
    const page = batch.metadata.pages.filter(
      (p) => p.pageId === entry.pageId && p.pageVersion === entry.version,
    );
    if (
      page.length !== 1 ||
      page[0]!.snapshot.id !== entry.legacyId ||
      !page[0]!.snapshot.deleted
    )
      throw Error("Deleted dataset snapshot scope changed");
  }
  for (const registration of a.registrations ?? []) {
    if (
      (registration.table !== "dataset_member_bindings" &&
        registration.table !== "dataset_viewer_bindings") ||
      registration.key.length !== 4 ||
      !tuples.has(canonical([registration.key[2], registration.key[3]])) ||
      !/^[a-f0-9]{64}$/.test(registration.sha256)
    )
      throw Error("Deleted dataset registration outside admitted scope");
  }
  if (
    batch.metadata.pages.length !== tuples.size ||
    batch.metadata.resources.some((r) => ids.has(r.legacyId) && !r.deleted)
  )
    throw Error("Deleted dataset page scope changed");
  for (const row of a.base.inventory.pageReceipts)
    if (pages.has(row.pageId))
      throw Error("Deleted dataset overlaps protected page");
  return a;
}
/** Preflight accepts only sealed new rows plus unchanged protected rows; postflight requires all new rows. */
export async function verifyDeletedDatasetAuthority(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
  complete = false,
): Promise<void> {
  const a = validateDeletedDatasetBatch(batch);
  const inventory = a.base.inventory;
  await validateAdditiveVerification(a.base);
  const { runtime, archive } = destinationSchemas(schema);
  equal(
    (
      await db.query(
        `SELECT fingerprint FROM ${archive}.dataset_receipts WHERE source_namespace=$1`,
        [a.sourceNamespace],
      )
    ).rows,
    [{ fingerprint: inventory.datasetFingerprint }],
    "immutable deleted dataset base receipt",
  );
  if (inventory.datasetAdditiveReceipts)
    equal(
      (
        await db.query(
          `SELECT source_namespace,authority_sha256,fingerprint,base_fingerprint FROM ${archive}.dataset_additive_receipts WHERE source_namespace=$1 ORDER BY authority_sha256`,
          [a.sourceNamespace],
        )
      ).rows,
      inventory.datasetAdditiveReceipts,
      "protected additive receipts",
    );
  const plans = migrationDatasetTablePlans(batch);
  equal(
    inventory.tables.map((t) => t.table).sort(),
    plans.map((t) => t.table).sort(),
    "complete deleted dataset protected inventory",
  );
  for (const plan of plans) {
    const baseline = inventory.tables.find((t) => t.table === plan.table)!;
    const protectedRows = new Map(
      baseline.rows.map((r) => [canonical(r.key), r.sha256]),
    );
    if (protectedRows.size !== baseline.rows.length)
      throw Error("Duplicate deleted dataset protected row");
    const own = new Map(
      plan.rows.map((r) => [
        canonical(plan.keys.map((k) => r[k])),
        hash(normalizeAdditiveRow(r)),
      ]),
    );
    for (const [key, digest] of own)
      if (protectedRows.has(key) && protectedRows.get(key) !== digest)
        throw Error("Deleted dataset attempted protected row replacement");
    for (const { value } of (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${plan.table} t WHERE source_namespace=$1`,
        [a.sourceNamespace],
      )
    ).rows) {
      const row = normalizeAdditiveRow(value as LegacyRow);
      const key = canonical(plan.keys.map((k) => row[k]));
      const digest = hash(row);
      if (protectedRows.has(key)) {
        if (protectedRows.get(key) !== digest)
          throw Error("Protected deleted dataset metadata changed");
        protectedRows.delete(key);
      } else if (own.get(key) !== digest)
        throw Error("Unexpected deleted dataset metadata");
      own.delete(key);
    }
    if (protectedRows.size || (complete && own.size))
      throw Error("Missing deleted dataset metadata");
  }
  for (const [table, columns] of Object.entries(protectedTables)) {
    const baseline = inventory.protectedRows.filter((r) => r.table === table);
    const protectedRows = new Map(
      baseline.map((r) => [canonical(r.key), r.sha256]),
    );
    const added = (a.registrations ?? []).filter((r) => r.table === table);
    const own = new Map(added.map((r) => [canonical(r.key), r.sha256]));
    if (
      protectedRows.size !== baseline.length ||
      own.size !== added.length ||
      [...baseline, ...added].some(
        (r) =>
          r.key.length !== columns.length || !/^[a-f0-9]{64}$/.test(r.sha256),
      )
    )
      throw Error("Invalid sealed deleted registration inventory");
    const approve = (row: LegacyRow) => {
      const key = canonical(columns.map((c) => row[c]));
      const digest = hash(row);
      if (own.has(key) && own.get(key) !== digest)
        throw Error("Conflicting deleted registration approval");
      own.set(key, digest);
    };
    if (table === "dataset_mutation_operations")
      for (const { operation: o, sourceNamespace, bindingName } of batch
        .metadata.operations ?? [])
        approve({
          backend_id: o.backendId,
          backend_version: o.backendVersion,
          page_id: o.page.id,
          page_version: o.page.version,
          name: o.name,
          source_namespace: sourceNamespace,
          binding_name: bindingName,
          dataset_id: o.datasetId,
          operation: o,
        });
    if (table === "dataset_source_queries")
      for (const { receipt, queries } of batch.sourceQueryRegistrations ?? [])
        for (const q of queries)
          approve({
            backend_id: receipt.backendId,
            backend_version: receipt.deployment.version,
            page_id: receipt.pageId,
            page_version: receipt.pageVersion,
            name: q.name,
            registration: {
              ...q,
              backendId: receipt.backendId,
              backendVersion: receipt.deployment.version,
              pageId: receipt.pageId,
              sourceNamespace: a.sourceNamespace,
            },
          });
    for (const [key, digest] of own)
      if (protectedRows.has(key) && protectedRows.get(key) !== digest)
        throw Error("Deleted registration replaces protected authority");
    const predicate =
      table === "dataset_source_queries"
        ? "registration->>'sourceNamespace'=$1"
        : "source_namespace=$1";
    for (const { value } of (
      await db.query(
        `SELECT row_to_json(t) AS value FROM ${runtime}.${table} t WHERE ${predicate}`,
        [a.sourceNamespace],
      )
    ).rows) {
      const row = value as LegacyRow;
      const key = canonical(columns.map((c) => row[c]));
      const digest = hash(row);
      if (protectedRows.has(key)) {
        if (protectedRows.get(key) !== digest)
          throw Error("Protected deleted dataset registration changed");
        protectedRows.delete(key);
      } else if (own.get(key) !== digest)
        throw Error("Unexpected deleted dataset registration");
      own.delete(key);
    }
    if (protectedRows.size || (complete && own.size))
      throw Error("Missing deleted dataset registration");
  }
}
export function isProtectedDeletedDatasetRow(
  batch: DatasetMigrationBatch,
  table: string,
  key: readonly unknown[],
  row: LegacyRow,
): boolean {
  const a = batch.deletedAdditive;
  return !!a?.base.inventory.tables
    .find((t) => t.table === table)
    ?.rows.some(
      (r) =>
        canonical(r.key) === canonical(key) &&
        r.sha256 === hash(normalizeAdditiveRow(row)),
    );
}
/** Initial association only; runtime lifecycle handlers consume these immutable proofs later. */
export async function persistDeletedDatasetLifecycleLinks(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
  retry: boolean,
): Promise<void> {
  const a = validateDeletedDatasetBatch(batch);
  const { runtime } = destinationSchemas(schema);
  const authority = deletedDatasetAuthoritySha256(a);
  for (const entry of new Map(
    a.admitted.map((e) => [e.legacyId, e]),
  ).values()) {
    const pages = batch.metadata.pages.filter((p) => p.pageId === entry.pageId);
    const file = (
      await db.query(
        `SELECT owner,head,deleted_at,access FROM ${runtime}.files WHERE id=$1 FOR UPDATE`,
        [entry.pageId],
      )
    ).rows;
    if (
      file.length !== 1 ||
      file[0]!.deleted_at == null ||
      Number(file[0]!.head) !== Math.max(...pages.map((p) => p.pageVersion)) ||
      (file[0]!.access as { visibility?: string } | null)?.visibility !==
        pages[0]!.snapshot.visibility
    )
      throw Error("Deleted dataset current file authority differs");
    const values = [a.sourceNamespace, entry.legacyId, entry.pageId, authority];
    async function link(
      table:
        | "dataset_deleted_page_lifecycle_links"
        | "dataset_deleted_lifecycle_links",
    ) {
      const existing = (
        await db.query(
          `SELECT source_namespace,legacy_id,page_id,authority_sha256 FROM ${runtime}.${table} WHERE source_namespace=$1 AND legacy_id=$2`,
          values.slice(0, 2),
        )
      ).rows;
      if (existing.length)
        equal(
          existing,
          [
            {
              source_namespace: values[0],
              legacy_id: values[1],
              page_id: values[2],
              authority_sha256: values[3],
            },
          ],
          "deleted dataset lifecycle link",
        );
      else {
        if (retry)
          throw Error("Deleted dataset lifecycle link removed after import");
        await db.query(
          `INSERT INTO ${runtime}.${table} VALUES ($1,$2,$3,$4)`,
          values,
        );
      }
    }
    await link("dataset_deleted_page_lifecycle_links");
    const resource = batch.metadata.resources.find(
      (r) => r.legacyId === entry.legacyId,
    );
    if (
      resource &&
      pages.some(
        (p) => p.snapshot.standaloneDataset?.datasetId === entry.legacyId,
      )
    ) {
      if (
        resource.snapshot.id !== entry.legacyId ||
        resource.owner !== file[0]!.owner ||
        !resource.deleted ||
        canonical(semanticAccess(resource.access)) !==
          canonical(semanticAccess(file[0]!.access))
      )
        throw Error("Deleted dataset resource association differs");
      await link("dataset_deleted_lifecycle_links");
    }
  }
}
export async function verifyDeletedDatasetLifecycleLinks(
  db: SqlReader,
  schema: string,
  batch: DatasetMigrationBatch,
): Promise<void> {
  const a = validateDeletedDatasetBatch(batch);
  const { runtime } = destinationSchemas(schema);
  const authority = deletedDatasetAuthoritySha256(a);
  for (const entry of new Map(
    a.admitted.map((e) => [e.legacyId, e]),
  ).values()) {
    const expected = [
      {
        source_namespace: a.sourceNamespace,
        legacy_id: entry.legacyId,
        page_id: entry.pageId,
        authority_sha256: authority,
      },
    ];
    equal(
      (
        await db.query(
          `SELECT source_namespace,legacy_id,page_id,authority_sha256 FROM ${runtime}.dataset_deleted_page_lifecycle_links WHERE source_namespace=$1 AND legacy_id=$2`,
          [a.sourceNamespace, entry.legacyId],
        )
      ).rows,
      expected,
      "admitted deleted page lifecycle link",
    );
    const resource = batch.metadata.resources.find(
      (r) => r.legacyId === entry.legacyId,
    );
    const linked =
      resource &&
      batch.metadata.pages.some(
        (p) =>
          p.pageId === entry.pageId &&
          p.snapshot.standaloneDataset?.datasetId === entry.legacyId,
      );
    equal(
      (
        await db.query(
          `SELECT source_namespace,legacy_id,page_id,authority_sha256 FROM ${runtime}.dataset_deleted_lifecycle_links WHERE source_namespace=$1 AND legacy_id=$2`,
          [a.sourceNamespace, entry.legacyId],
        )
      ).rows,
      linked ? expected : [],
      "admitted deleted resource lifecycle link",
    );
  }
}
