import { registeredPlan } from "@/lib/registered-page-queries/registry";
import type { HtmlBackendLink, HtmlPageVersion } from "@artifactbin/contracts";
import type { HtmlBackendVersionRecord } from "@/lib/html-backends";
import type { Queryable } from "@artifactbin/contracts";
import { validateDatasetPolicyForRow } from "@/lib/datasets/policy/validation";
import { nativeCatalogDigest } from "./catalog-digest";
import { validateNativeCatalogDatasetSelection, validateNativeCatalogRevisionScope } from "./catalog-selection";
import type {
  NativeCatalogProjection,
  NativeCatalogDataset,
  NativeCatalogVersion,
} from "./catalog-contracts";
const validHash = (s: string) => /^[a-f0-9]{64}$/.test(s),
  validDate = (s: unknown) =>
    typeof s === "string" && Number.isFinite(Date.parse(s));
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
function catalogKeys(meta: Record<string, unknown>): string[] {
  const keys: string[] = [];
  if (typeof meta.objectKey === "string") keys.push(meta.objectKey);
  if (meta.catalog === undefined) return keys; // original missing catalog stays unavailable; never invent [] or schema.
  const catalog = meta.catalog;
  if (
    !record(catalog) ||
    !["stored", "postgres"].includes(String(catalog.kind)) ||
    typeof catalog.defaultSchema !== "string" ||
    !Array.isArray(catalog.tables)
  )
    throw Error("native_catalog_authoritative_shape");
  const identities = new Set<string>();
  for (const table of catalog.tables) {
    if (
      !record(table) ||
      typeof table.schema !== "string" ||
      typeof table.name !== "string" ||
      !Array.isArray(table.columns)
    )
      throw Error("native_catalog_authoritative_shape");
    const key = JSON.stringify([table.schema, table.name]);
    if (identities.has(key)) throw Error("native_catalog_duplicate_table");
    identities.add(key);
    const columns = new Set<string>();
    for (const column of table.columns) {
      if (
        !record(column) ||
        typeof column.name !== "string" ||
        columns.has(column.name) ||
        !["string", "number", "boolean", "date", "timestamp", "user"].includes(
          String(column.type),
        )
      )
        throw Error("native_catalog_authoritative_columns");
      columns.add(column.name);
    }
    if (table.objectKey !== undefined) {
      if (typeof table.objectKey !== "string")
        throw Error("native_catalog_object_key");
      keys.push(table.objectKey);
    }
  }
  return [...new Set(keys)];
}
export function validateNativeCatalogProjection(p: NativeCatalogProjection) {
  validateNativeCatalogRevisionScope(p);
  if (
    !p.sourceNamespace ||
    ![
      p.selectionSha256,
      p.sourceManifestSha256,
      p.objectManifestSha256,
      p.sha256,
    ].every(validHash)
  )
    throw Error("native_catalog_provenance");
  const ids = new Set<string>();
  for (const dataset of p.datasets) {
    validateNativeCatalogDatasetSelection(p, dataset);
    if (
      new Set(dataset.policyAudit.map((row) => row.revision)).size !==
        dataset.policyAudit.length ||
      dataset.policyAudit.some(
        (row) =>
          !Number.isSafeInteger(row.revision) ||
          row.revision < 0 ||
          !validDate(row.createdAt),
      )
    )
      throw Error("native_catalog_policy_audit");
    const a = dataset.authority,
      versions = [...dataset.versions].sort((x, y) => x.version - y.version),
      labels = versions.map((v) => v.version);
    if (
      !/^[A-Za-z0-9]{6,128}$/.test(dataset.targetId) ||
      !dataset.sourceId ||
      !validHash(dataset.sourceSha256) ||
      !validHash(dataset.relationsSha256) ||
      ids.has(dataset.targetId) ||
      !versions.length ||
      nativeCatalogDigest(labels) !==
        nativeCatalogDigest(
          [...dataset.expectedVersions].sort((x, y) => x - y),
        ) ||
      new Set(labels).size !== labels.length ||
      labels.at(-1) !== dataset.currentVersion
    )
      throw Error("native_catalog_history");
    ids.add(dataset.targetId);
    if (
      !a.tokenId ||
      (a.userId && a.groupId) ||
      !a.editId ||
      !["public", "unlisted", "private"].includes(a.visibility) ||
      !["viewer", "commenter", "editor"].includes(a.linkRole) ||
      !["read", "readwrite"].includes(a.access) ||
      ![a.createdAt, a.updatedAt].every(validDate) ||
      (a.deletedAt !== null && !validDate(a.deletedAt)) ||
      ![a.sharingRevision, a.policyRevision].every(
        (v) => Number.isSafeInteger(v) && v >= 0,
      )
    )
      throw Error("native_catalog_authority");
    if (
      new Set(a.shares.map((s) => s.email.trim().toLowerCase())).size !==
        a.shares.length ||
      a.shares.some(
        (s) =>
          !s.email.includes("@") ||
          !["viewer", "commenter", "editor"].includes(s.role),
      )
    )
      throw Error("native_catalog_shares");
    for (const version of versions) {
      if (
        !Number.isSafeInteger(version.version) ||
        version.version < 1 ||
        !validHash(version.sourceSha256) ||
        !validDate(version.createdAt) ||
        !record(version.meta) ||
        Object.hasOwn(version.meta, "nativeCatalogImport")
      )
        throw Error("native_catalog_version");
      for (const key of catalogKeys(version.meta)) {
        const candidates = [
          ...p.objects.filter(
            (o) => o.objectKey === key && o.targetKey === key,
          ),
          ...(p.typedUserRemaps ?? [])
            .filter((r) => r.targetKey === key)
            .map((r) => ({ sha256: r.targetSha256, bytes: r.targetBytes })),
        ];
        const matches = [
          ...new Map(
            candidates.map((o) => [JSON.stringify([o.sha256, o.bytes]), o]),
          ).values(),
        ];
        if (
          matches.length !== 1 ||
          (key.startsWith("dataset/") &&
            (!/^dataset\/[a-f0-9]{32}$/.test(key) ||
              !matches[0]!.sha256.startsWith(key.slice(8))))
        )
          throw Error("native_catalog_missing_historical_object");
      }
    }
    const current = versions.at(-1)!;
    if (
      record(current.meta.catalog) &&
      current.meta.catalog.kind === "postgres"
    )
      throw Error("native_catalog_external_connection_projection_required");
    validateDatasetPolicyForRow(
      { format: "dataset", meta: current.meta },
      a.datasetPolicy,
    );
  }
}
const receipt = (
  p: NativeCatalogProjection,
  d: NativeCatalogDataset,
  v: NativeCatalogVersion,
) => ({
  sourceNamespace: p.sourceNamespace,
  sourceId: d.sourceId,
  selectionSha256: p.selectionSha256,
  sourceManifestSha256: p.sourceManifestSha256,
  objectManifestSha256: p.objectManifestSha256,
  projectionSha256: p.sha256,
  datasetSourceSha256: d.sourceSha256,
  versionSourceSha256: v.sourceSha256,
});
const meta = (
  p: NativeCatalogProjection,
  d: NativeCatalogDataset,
  v: NativeCatalogVersion,
) => ({ ...v.meta, nativeCatalogImport: receipt(p, d, v) });
const archive = (
  p: NativeCatalogProjection,
  d: NativeCatalogDataset,
  v: NativeCatalogVersion,
) => ({
  version: v.version,
  title: v.title,
  description: v.description,
  format: "dataset",
  source: v.source,
  meta: meta(p, d, v),
  actor_user_id: v.actorUserId,
  actor_token_id: v.actorTokenId,
  created_at: iso(v.createdAt),
});
function head(p: NativeCatalogProjection, d: NativeCatalogDataset) {
  const a = d.authority,
    v = d.versions.find((v) => v.version === d.currentVersion)!;
  return {
    token_id: a.tokenId,
    user_id: a.userId,
    group_id: a.groupId,
    creator_user_id: a.creatorUserId,
    visibility: a.visibility,
    link_role: a.linkRole,
    access: a.access,
    dataset_policy: a.datasetPolicy,
    sharing_revision: a.sharingRevision,
    policy_revision: a.policyRevision,
    ancestor_ids: [...a.ancestorIds],
    version: v.version,
    format: "dataset",
    source: v.source,
    meta: meta(p, d, v),
    title: v.title,
    description: v.description,
    edit_id: a.editId,
    actor_user_id: v.actorUserId,
    actor_token_id: v.actorTokenId,
    created_at: iso(a.createdAt),
    updated_at: iso(a.updatedAt),
    deleted_at: a.deletedAt === null ? null : iso(a.deletedAt),
  };
}
const normalize = (row: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k,
      ["_at"].some((suffix) => k.endsWith(suffix)) && v !== null ? iso(v) : v,
    ]),
  );
async function verifyDataset(
  tx: Queryable,
  p: NativeCatalogProjection,
  d: NativeCatalogDataset,
) {
  const expected = head(p, d),
    stored = (
      await tx.query<Record<string, unknown>>(
        `SELECT ${Object.keys(expected).join(",")} FROM artifacts WHERE id=$1 FOR UPDATE`,
        [d.targetId],
      )
    ).rows[0];
  if (
    !stored ||
    nativeCatalogDigest(normalize(stored)) !== nativeCatalogDigest(expected)
  )
    throw Error("native_catalog_collision");
  const expectedVersions = [...d.versions]
    .sort((a, b) => a.version - b.version)
    .map((v) => archive(p, d, v));
  const versions = (
    await tx.query<Record<string, unknown>>(
      "SELECT version,title,description,format,source,meta,actor_user_id,actor_token_id,created_at FROM artifact_versions WHERE artifact_id=$1 ORDER BY version",
      [d.targetId],
    )
  ).rows;
  if (
    nativeCatalogDigest(versions.map(normalize)) !==
    nativeCatalogDigest(expectedVersions)
  )
    throw Error("native_catalog_history_collision");
  const shares = (
      await tx.query<{ email: string; role: string }>(
        "SELECT email,role FROM artifact_shares WHERE artifact_id=$1 ORDER BY email",
        [d.targetId],
      )
    ).rows,
    expectedShares = d.authority.shares
      .map((s) => ({ email: s.email.trim().toLowerCase(), role: s.role }))
      .sort((a, b) => a.email.localeCompare(b.email));
  if (nativeCatalogDigest(shares) !== nativeCatalogDigest(expectedShares))
    throw Error("native_catalog_share_collision");
  const audit = (
    await tx.query<Record<string, unknown>>(
      "SELECT revision,policy,actor_user_id,actor_token_id,created_at FROM dataset_policy_audit WHERE dataset_id=$1 ORDER BY revision",
      [d.targetId],
    )
  ).rows;
  const expectedAudit = [...d.policyAudit]
    .sort((a, b) => a.revision - b.revision)
    .map((row) => ({
      revision: row.revision,
      policy: row.policy,
      actor_user_id: row.actorUserId,
      actor_token_id: row.actorTokenId,
      created_at: iso(row.createdAt),
    }));
  if (
    nativeCatalogDigest(audit.map(normalize)) !==
    nativeCatalogDigest(expectedAudit)
  )
    throw Error("native_catalog_policy_audit_collision");
  const reservation = (
    await tx.query<{ owner: string; consumed: boolean }>(
      "SELECT owner,consumed FROM artifact_id_registry WHERE id=$1",
      [d.targetId],
    )
  ).rows[0];
  if (
    !reservation?.consumed ||
    reservation.owner !==
      (d.authority.creatorUserId ?? d.authority.userId ?? d.authority.tokenId)
  )
    throw Error("native_catalog_identity_collision");
}
async function principals(tx: Queryable, d: NativeCatalogDataset) {
  const a = d.authority,
    users = [
      ...new Set(
        [
          a.userId,
          a.creatorUserId,
          ...d.versions.map((v) => v.actorUserId),
          ...d.policyAudit.map((v) => v.actorUserId),
        ].filter((v): v is string => !!v),
      ),
    ],
    tokens = [
      ...new Set(
        [
          a.tokenId,
          ...d.versions.map((v) => v.actorTokenId),
          ...d.policyAudit.map((v) => v.actorTokenId),
        ].filter((v): v is string => !!v),
      ),
    ];
  if (
    (await tx.query("SELECT id FROM users WHERE id=ANY($1::text[])", [users]))
      .rows.length !== users.length ||
    (await tx.query("SELECT id FROM tokens WHERE id=ANY($1::text[])", [tokens]))
      .rows.length !== tokens.length
  )
    throw Error("native_catalog_principal_unmapped");
  if (
    a.groupId &&
    !(await tx.query("SELECT id FROM groups WHERE id=$1", [a.groupId])).rows
      .length
  )
    throw Error("native_catalog_group_unmapped");
  if (a.ancestorIds.length) {
    const ancestors = (
      await tx.query<{
        id: string;
        format: string;
        user_id: string | null;
        group_id: string | null;
        token_id: string;
        ancestor_ids: string[];
      }>(
        "SELECT id,format,user_id,group_id,token_id,ancestor_ids FROM artifacts WHERE id=ANY($1::text[]) FOR SHARE",
        [a.ancestorIds],
      )
    ).rows;
    if (
      ancestors.length !== a.ancestorIds.length ||
      a.ancestorIds.some((id, index) => {
        const row = ancestors.find((r) => r.id === id);
        return (
          !row ||
          row.format !== "folder" ||
          row.user_id !== a.userId ||
          row.group_id !== a.groupId ||
          (!a.userId && !a.groupId && row.token_id !== a.tokenId) ||
          nativeCatalogDigest(row.ancestor_ids) !==
            nativeCatalogDigest(a.ancestorIds.slice(0, index))
        );
      })
    )
      throw Error("native_catalog_placement");
  }
}
export async function applyNativeCatalog(
  tx: Queryable,
  p: NativeCatalogProjection,
  pageId: string,
) {
  for (const d of [...p.datasets].sort((a, b) =>
    a.targetId.localeCompare(b.targetId),
  )) {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtext('native-catalog:' || $1))",
      [d.targetId],
    );
    const existing = (
      await tx.query("SELECT id FROM artifacts WHERE id=$1 FOR UPDATE", [
        d.targetId,
      ])
    ).rows[0];
    if (existing) {
      await verifyDataset(tx, p, d);
      continue;
    }
    await principals(tx, d);
    const reservation = await tx.query(
      "INSERT INTO artifact_id_registry(id,owner,consumed) VALUES($1,$2,true) ON CONFLICT DO NOTHING RETURNING id",
      [
        d.targetId,
        d.authority.creatorUserId ?? d.authority.userId ?? d.authority.tokenId,
      ],
    );
    if (!reservation.rows.length)
      throw Error("native_catalog_identity_collision");
    const value = head(p, d),
      columns = ["id", ...Object.keys(value)],
      values: unknown[] = [d.targetId, ...Object.values(value)];
    await tx.query(
      `INSERT INTO artifacts(${columns.join(",")}) VALUES(${columns.map((name, i) => `$${i + 1}${["meta", "dataset_policy"].includes(name) ? "::jsonb" : ""}`).join(",")})`,
      values.map((v, i) =>
        ["meta", "dataset_policy"].includes(columns[i]!)
          ? v === null
            ? null
            : JSON.stringify(v)
          : v,
      ),
    );
    for (const v of [...d.versions].sort((a, b) => a.version - b.version)) {
      const row = archive(p, d, v),
        names = ["artifact_id", ...Object.keys(row)],
        params = [d.targetId, ...Object.values(row)];
      await tx.query(
        `INSERT INTO artifact_versions(${names.join(",")}) VALUES(${names.map((name, i) => `$${i + 1}${name === "meta" ? "::jsonb" : ""}`).join(",")})`,
        params.map((v, i) =>
          names[i] === "meta" ? (v === null ? null : JSON.stringify(v)) : v,
        ),
      );
    }
    for (const share of d.authority.shares)
      await tx.query(
        "INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,$3)",
        [d.targetId, share.email.trim().toLowerCase(), share.role],
      );
    await tx.query(
      "INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id,document_state) VALUES($1,$2,0,'',$3,0,0,$4,$5,$6::jsonb)",
      [
        d.targetId,
        d.authority.editId,
        value.source ?? "",
        value.actor_user_id,
        value.actor_token_id,
        JSON.stringify({ version: d.currentVersion }),
      ],
    );
    for (const row of d.policyAudit)
      await tx.query(
        "INSERT INTO dataset_policy_audit(dataset_id,revision,policy,actor_user_id,actor_token_id,created_at) VALUES($1,$2,$3::jsonb,$4,$5,$6)",
        [
          d.targetId,
          row.revision,
          row.policy === null ? null : JSON.stringify(row.policy),
          row.actorUserId,
          row.actorTokenId,
          iso(row.createdAt),
        ],
      );
    await verifyDataset(tx, p, d);
  }
  await verifyImports(tx, p, pageId);
}
export async function verifyNativeCatalog(
  tx: Queryable,
  p: NativeCatalogProjection,
  pageId: string,
) {
  for (const dataset of p.datasets) await verifyDataset(tx, p, dataset);
  await verifyImports(tx, p, pageId);
}

async function verifyImports(
  tx: Queryable,
  p: NativeCatalogProjection,
  pageId: string,
) {
  const imports = p.imports.filter((item) => item.pageId === pageId),
    groups = new Map<string, typeof imports>();
  for (const item of imports) {
    if (!p.datasets.some((dataset) => dataset.targetId === item.datasetId))
      throw Error("native_catalog_import_dataset");
    const key = JSON.stringify([
      item.pageVersion,
      item.backendId,
      item.backendVersion,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const items of groups.values()) {
    const first = items[0]!,
      saved = (
        await tx.query<{
          source: string;
          meta: {
            htmlIdentity: { nextNodeId: number };
            htmlLinks: HtmlBackendLink[];
          };
        }>(
          "SELECT source,meta FROM artifact_versions WHERE artifact_id=$1 AND version=$2 AND format='html'",
          [pageId, first.pageVersion],
        )
      ).rows[0];
    const owner = (
      await tx.query<{ user_id: string | null }>(
        "SELECT user_id FROM artifacts WHERE id=$1 AND format='html' AND deleted_at IS NULL FOR SHARE",
        [pageId],
      )
    ).rows[0];
    if (!saved || !owner?.user_id) throw Error("native_catalog_import_page");
    const links = saved.meta.htmlLinks ?? [],
      link = links.find(
        (link) =>
          link.kind === "backend" &&
          link.backendId === first.backendId &&
          link.version === first.backendVersion,
      );
    const backend = (
      await tx.query<HtmlBackendVersionRecord>(
        'SELECT backend_id AS "backendId",page_id AS "pageId",version,name,source,type_defs AS "typeDefs",compiled,owner_id AS "ownerId",secret_bindings AS "secretBindings" FROM html_backend_versions WHERE backend_id=$1 AND version=$2 FOR SHARE',
        [first.backendId, first.backendVersion],
      )
    ).rows[0];
    if (!link || !backend || backend.ownerId !== owner.user_id)
      throw Error("native_catalog_import_backend");
    const page: HtmlPageVersion = {
        pageId,
        version: first.pageVersion,
        revision: String(first.pageVersion),
        html: saved.source,
        nextNodeId: saved.meta.htmlIdentity.nextNodeId,
        links,
      },
      plan = registeredPlan(page, link, backend);
    if (
      !plan ||
      plan.imports.length !== items.length ||
      new Set(items.map((i) => i.alias)).size !== items.length ||
      items.some(
        (item) =>
          plan.imports.filter(
            (binding) =>
              binding.alias === item.alias &&
              binding.binding === item.datasetId &&
              binding.table === item.table,
          ).length !== 1,
      )
    )
      throw Error("native_catalog_import_registration");
  }
}
