import {
  nativeCatalogUserTables,
  remapNativeCatalogMetadata,
} from "./catalog-user-remap";
import type { NativeCatalogUserTable } from "./catalog-user-remap-contracts";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { nativeCatalogBytes, nativeCatalogDigest } from "./catalog-digest";
import { nativeCatalogPolicyAuditSelected, selectNativeCatalogSourceVersions } from "./catalog-selection";
import type {
  NativeCatalogProjection,
  NativeCatalogObjectSource,
  NativeCatalogObject,
  NativeCatalogIdentityMap,
} from "./catalog-contracts";
const iso = (value: unknown) => new Date(String(value)).toISOString();
function mapped(
  map: Readonly<Record<string, string>>,
  value: unknown,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !Object.hasOwn(map, value) || !map[value])
    throw Error("native_catalog_identity_unmapped");
  return map[value]!;
}
/** Only known identity-bearing fields are translated. Schemas, row bytes,
 * object keys, SQL and arbitrary literal strings are never guessed or rewritten. */
function nativeCatalogMappedMetadata(
  meta: Record<string, unknown>,
  maps: NativeCatalogIdentityMap,
): Record<string, unknown> {
  const copy = structuredClone(meta);
  const columns = (values: unknown) => {
    if (!Array.isArray(values)) return;
    for (const column of values) {
      const members = column?.constraints?.memberOf;
      if (Array.isArray(members))
        column.constraints.memberOf = members.map((ref: unknown) => {
          if (ref === "current") return ref;
          if (typeof ref !== "string" || !ref.startsWith("ref:"))
            throw Error("native_catalog_member_scope");
          return "ref:" + mapped(maps.artifacts, ref.slice(4));
        });
    }
  };
  columns(copy.columns);
  const catalog = copy.catalog as
    { tables?: { columns?: unknown }[] } | undefined;
  for (const table of catalog?.tables ?? []) columns(table.columns);
  if (typeof copy.userScopeDocument === "string")
    copy.userScopeDocument = mapped(maps.artifacts, copy.userScopeDocument);
  return copy;
}
function nativeCatalogMappedPolicy(
  value: unknown,
  maps: NativeCatalogIdentityMap,
): unknown {
  const policy = structuredClone(value) as {
    version?: number;
    allow?: { from: Record<string, string> }[];
  } | null;
  if (policy?.version === 2)
    for (const grant of policy.allow ?? [])
      for (const [field, value] of Object.entries(grant.from))
        if (value !== "*" && value !== "$owner")
          grant.from[field] = mapped(
            field === "artifact" ? maps.artifacts : maps.users,
            value,
          )!;
  return policy;
}
/** Verify the existing canonical export, not a newly queried/sampled dataset. */
export async function verifyNativeCanonicalDatasets(
  p: NativeCatalogProjection,
  source: NativeCatalogObjectSource,
) {
  const userTables: NativeCatalogUserTable[] = [];
  for (const dataset of p.datasets) {
    if (!source.dataset) throw Error("native_catalog_source_receipt_required");
    const bytes = await source.dataset(dataset);
    if (nativeCatalogBytes(bytes) !== dataset.sourceSha256)
      throw Error("native_catalog_source_digest");
    const exported = JSON.parse(bytes.toString("utf8")) as {
      heads: Record<string, unknown>[];
      versions: Record<string, unknown>[];
    };
    const heads = exported.heads?.filter((row) => row.id === dataset.sourceId);
    if (heads?.length !== 1) throw Error("native_catalog_source_head");
    if (!source.relations)
      throw Error("native_catalog_source_relations_required");
    const relationBytes = await source.relations(dataset);
    if (nativeCatalogBytes(relationBytes) !== dataset.relationsSha256)
      throw Error("native_catalog_source_relations_digest");
    const relations = JSON.parse(relationBytes.toString("utf8")) as {
      heads: { id: string; version: number; updated_at: string }[];
      dataset_policy_audit: {
        dataset_id: string;
        revision: number;
        policy: unknown;
        actor_user_id: string | null;
        actor_token_id: string | null;
        created_at: string;
      }[];
      artifact_shares: { artifact_id: string; email: string; role: string }[];
    };
    const relationHeads = relations.heads?.filter(
      (row) => row.id === dataset.sourceId,
    );
    if (
      relationHeads?.length !== 1 ||
      relationHeads[0]!.version !== dataset.currentVersion ||
      iso(relationHeads[0]!.updated_at) !== iso(heads[0]!.updated_at) ||
      !Array.isArray(relations.artifact_shares)
    )
      throw Error("native_catalog_source_relations_head");
    const normalizeShares = (
      shares: readonly { email: string; role: string }[],
    ) =>
      shares
        .map((row) => ({
          email: row.email.trim().toLowerCase(),
          role: row.role,
        }))
        .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
    if (
      nativeCatalogDigest(
        normalizeShares(
          relations.artifact_shares.filter(
            (row) => row.artifact_id === dataset.sourceId,
          ),
        ),
      ) !== nativeCatalogDigest(normalizeShares(dataset.authority.shares))
    )
      throw Error("native_catalog_source_shares");
    if (!Array.isArray(relations.dataset_policy_audit))
      throw Error("native_catalog_source_audit_required");
    const audit = relations.dataset_policy_audit
      .filter((row) => row.dataset_id === dataset.sourceId && nativeCatalogPolicyAuditSelected(p, dataset, row.revision))
      .map((row) => ({
        revision: row.revision,
        policy: nativeCatalogMappedPolicy(row.policy, p.identities),
        actorUserId: mapped(p.identities.users, row.actor_user_id),
        actorTokenId: mapped(p.identities.tokens, row.actor_token_id),
        createdAt: iso(row.created_at),
      }))
      .sort((a, b) => a.revision - b.revision);
    if (
      nativeCatalogDigest(audit) !==
      nativeCatalogDigest(
        [...dataset.policyAudit].sort((a, b) => a.revision - b.revision),
      )
    )
      throw Error("native_catalog_source_audit");

    const head = heads[0]!,
      versions = selectNativeCatalogSourceVersions(p, dataset, head, exported.versions ?? []);
    for (const version of dataset.versions) {
      const row = versions.get(version.version);
      if (row)
        userTables.push(
          ...nativeCatalogUserTables(
            row.meta as Record<string, unknown>,
            dataset.sourceId,
            version.version,
          ),
        );
      if (
        !row ||
        row.format !== "dataset" ||
        nativeCatalogDigest(row) !== version.sourceSha256 ||
        !isDeepStrictEqual(
          remapNativeCatalogMetadata(
            row.meta as Record<string, unknown>,
            nativeCatalogMappedMetadata(
              row.meta as Record<string, unknown>,
              p.identities,
            ),
            dataset.sourceId,
            version.version,
            (p.typedUserRemaps ?? []).filter(
              (r) =>
                r.sourceId === dataset.sourceId &&
                r.version === version.version,
            ),
          ),
          version.meta,
        ) ||
        row.source !== version.source ||
        (row.title ?? null) !== version.title ||
        (row.description ?? null) !== version.description ||
        iso(row === head ? head.updated_at : row.created_at) !==
          iso(version.createdAt)
      )
        throw Error("native_catalog_source_version");
    }
    const a = dataset.authority;
    if (
      mapped(p.identities.artifacts, dataset.sourceId) !== dataset.targetId ||
      mapped(p.identities.tokens, head.token_id) !== a.tokenId ||
      mapped(p.identities.users, head.user_id) !== a.userId ||
      mapped(p.identities.groups, head.group_id) !== a.groupId ||
      mapped(p.identities.users, head.creator_user_id) !== a.creatorUserId ||
      !isDeepStrictEqual(
        ((head.ancestor_ids as unknown[]) ?? []).map((id) =>
          mapped(p.identities.artifacts, id),
        ),
        a.ancestorIds,
      )
    )
      throw Error("native_catalog_source_owner");
    for (const version of dataset.versions) {
      const row = versions.get(version.version)!;
      if (
        mapped(p.identities.users, row.actor_user_id) !== version.actorUserId ||
        mapped(p.identities.tokens, row.actor_token_id) !== version.actorTokenId
      )
        throw Error("native_catalog_source_actor");
    }
    if (
      head.edit_id !== a.editId ||
      head.visibility !== a.visibility ||
      (head.link_role ?? "viewer") !== a.linkRole ||
      (head.access ?? "read") !== a.access ||
      Number(head.sharing_revision ?? 0) !== a.sharingRevision ||
      Number(head.policy_revision ?? 0) !== a.policyRevision ||
      !isDeepStrictEqual(
        nativeCatalogMappedPolicy(head.dataset_policy ?? null, p.identities),
        a.datasetPolicy,
      ) ||
      iso(head.created_at) !== iso(a.createdAt) ||
      iso(head.updated_at) !== iso(a.updatedAt) ||
      (head.deleted_at ? iso(head.deleted_at) : null) !==
        (a.deletedAt ? iso(a.deletedAt) : null)
    )
      throw Error("native_catalog_source_authority");
  }
  return userTables;
}
/** Canonical object ledger loader. Paths remain private; every raw ledger byte
 * is digest-bound, then realpath containment and raw size/hash are rechecked. */
/** @public Host canonical-export adapter. */
export async function canonicalNativeObjectSource(
  root: string,
  ledgerPath: string,
  datasetReceipts: Readonly<
    Record<
      string,
      {
        path: string;
        sha256: string;
        relations: { path: string; sha256: string };
      }
    >
  > = {},
): Promise<{
  source: NativeCatalogObjectSource;
  objects: NativeCatalogObject[];
  objectManifestSha256: string;
}> {
  const base = await realpath(root);
  const read = async (file: string, relative: string) => {
    const absolute = await realpath(path.resolve(relative, file));
    if (!absolute.startsWith(base + path.sep))
      throw Error("native_catalog_source_path");
    return readFile(absolute);
  };
  const ledgerFile = await realpath(path.resolve(base, ledgerPath));
  if (!ledgerFile.startsWith(base + path.sep))
    throw Error("native_catalog_source_path");
  const bytes = await readFile(ledgerFile),
    rows = JSON.parse(bytes.toString()) as {
      objectKey: string;
      status: string;
      sha256: string;
      bytes: number;
      path: string;
      contentType?: string;
    }[],
    byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.status !== "copied") continue;
    const prior = byKey.get(row.objectKey);
    if (prior && (prior.sha256 !== row.sha256 || prior.bytes !== row.bytes))
      throw Error("native_catalog_source_ambiguous");
    byKey.set(row.objectKey, row);
  }
  return {
    objectManifestSha256: nativeCatalogBytes(bytes),
    objects: [...byKey.values()].map((r) => ({
      objectKey: r.objectKey,
      targetKey: r.objectKey,
      status: "copied",
      sha256: r.sha256,
      bytes: r.bytes,
      ...(r.contentType ? { contentType: r.contentType } : {}),
    })),
    source: {
      objectManifestSha256: nativeCatalogBytes(bytes),
      async read(object) {
        const row = byKey.get(object.objectKey);
        if (!row || row.sha256 !== object.sha256 || row.bytes !== object.bytes)
          throw Error("native_catalog_source_object_receipt");
        const bytes = await read(row.path, path.dirname(ledgerFile));
        if (
          bytes.length !== row.bytes ||
          nativeCatalogBytes(bytes) !== row.sha256
        )
          throw Error("native_catalog_source_object_digest");
        return bytes;
      },
      async relations(dataset) {
        const receipt = datasetReceipts[dataset.sourceId]?.relations;
        if (!receipt || receipt.sha256 !== dataset.relationsSha256)
          throw Error("native_catalog_source_relations_receipt");
        const bytes = await read(receipt.path, base);
        if (nativeCatalogBytes(bytes) !== receipt.sha256)
          throw Error("native_catalog_source_relations_digest");
        return bytes;
      },
      async dataset(dataset) {
        const receipt = datasetReceipts[dataset.sourceId];
        if (!receipt || receipt.sha256 !== dataset.sourceSha256)
          throw Error("native_catalog_source_dataset_receipt");
        const bytes = await read(receipt.path, base);
        if (nativeCatalogBytes(bytes) !== receipt.sha256)
          throw Error("native_catalog_source_dataset_digest");
        return bytes;
      },
    },
  };
}
