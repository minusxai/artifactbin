import type { AccessPolicy, ShareRole } from "../../contracts.ts";
import type { LegacyRow, LegacyArtifact, MigrationMaps } from "../contracts.ts";
import type {
  Principal,
  DocumentSnapshot,
  DatasetSnapshot,
} from "../../datasets/policy/contracts.ts";
import type { DatasetImportMetadata } from "../../datasets/import-contracts.ts";
import type {
  DatasetMetadataInput,
  DatasetMetadataPlan,
} from "./planner-contracts.ts";
import { canonical, record, receiptMap, catalogVersion } from "./catalog.ts";
export const generatedDatasetBackendSource = `export const typeDefs = \`
 scalar DatasetRows
 type DatasetColumn { name: String! type: String! }
 type DatasetWindow { version: Int! schema: String! table: String! columns: [DatasetColumn!]! rows: DatasetRows! offset: Int! nextOffset: Int totalRows: Int! }
 type Query { read(binding: String!, schema: String!, table: String!, offset: Int!, limit: Int!): DatasetWindow! }
\`;
export default { Query: { read: (args, _principal, caps) => caps.dataset.read(args) } };
`;
function principal(row: LegacyRow): Principal {
  return row.group_id
    ? { groupId: String(row.group_id), userId: null, tokenId: null }
    : {
        userId: row.user_id ? String(row.user_id) : null,
        tokenId: row.token_id ? String(row.token_id) : null,
      };
}
function owner(row: LegacyRow, maps: MigrationMaps): string {
  const map = row.group_id
    ? maps.groups
    : row.user_id
      ? maps.users
      : maps.tokens;
  const key = String(row.group_id ?? row.user_id ?? row.token_id ?? "");
  if (!key || !Object.hasOwn(map, key) || !map[key])
    throw Error("Unmapped dataset owner");
  return map[key]!;
}
const revision = (value: unknown): number => {
  const n = value ?? 0;
  if (!Number.isSafeInteger(n) || Number(n) < 0)
    throw Error("Invalid authority revision");
  return Number(n);
};
function access(
  row: LegacyRow,
  shares: readonly LegacyRow[],
  maps: MigrationMaps,
): AccessPolicy {
  if (!["private", "public", "unlisted"].includes(String(row.visibility)))
    throw Error("Unsupported dataset visibility");
  const roles = ["viewer", "commenter", "editor"];
  const linkRole = row.link_role ?? "viewer";
  if (!roles.includes(String(linkRole)))
    throw Error("Unsupported dataset link role");
  const named: Record<string, ShareRole> = Object.create(null);
  for (const share of shares) {
    if (!roles.includes(String(share.role)))
      throw Error("Unsupported dataset named role");
    const actor = share.user_id
      ? maps.users[String(share.user_id)]
      : typeof share.email === "string"
        ? share.email.trim().toLowerCase()
        : null;
    if (!actor) throw Error("Unmapped dataset named share");
    const role = share.role as ShareRole;
    if (
      !Object.hasOwn(named, actor) ||
      roles.indexOf(role) > roles.indexOf(named[actor]!)
    )
      named[actor] = role;
  }
  return {
    visibility: row.visibility as AccessPolicy["visibility"],
    linkRole: linkRole as ShareRole,
    shares: named,
    version: revision(row.sharing_revision),
  };
}
export function planDatasetMetadata(
  input: DatasetMetadataInput,
): DatasetMetadataPlan {
  const { manifest, maps } = input;
  if (
    !manifest.sourceNamespace ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.tables.relations)
  )
    throw Error("Invalid dataset source");
  if (
    !input.relationProvenance ||
    !Number.isFinite(Date.parse(input.relationProvenance.exportedAt)) ||
    !/^[a-f0-9]{64}$/.test(input.relationProvenance.manifestSha256)
  )
    throw Error("Missing supplemental relation provenance");
  const relationKeys = new Set<string>();
  for (const row of manifest.tables.relations!) {
    const key = canonical([
      row.subject_kind,
      row.subject_id,
      row.verb,
      row.object_kind,
      row.object_id,
    ]);
    if (relationKeys.has(key)) throw Error("Ambiguous source relation");
    relationKeys.add(key);
  }
  const receipts = receiptMap(input.receipts);
  const metadata: DatasetImportMetadata = {
    sourceNamespace: manifest.sourceNamespace,
    bindings: [],
    pages: [],
    resources: [],
    versions: [],
    principals: [],
    groups: [],
    acceptedJoins: [],
  };
  const users = new Map<string, LegacyRow>();
  const userActors = new Set<string>();
  for (const row of manifest.tables.users ?? []) {
    const id = String(row.id ?? "");
    const actor = maps.users[id];
    if (!id || users.has(id) || !actor || userActors.has(actor))
      throw Error("Ambiguous legacy user mapping");
    users.set(id, row);
    userActors.add(actor);
    if (
      row.expires_at !== undefined &&
      row.expires_at !== null &&
      (typeof row.expires_at !== "string" ||
        !Number.isFinite(Date.parse(row.expires_at)))
    )
      throw Error("Invalid legacy identity expiration");
    const kind =
      row.kind === "account" || row.kind === "user"
        ? "user"
        : row.kind === "guest"
          ? "guest"
          : row.kind === "testuser"
            ? "testuser"
            : null;
    if (!kind) throw Error("Unsupported legacy identity kind");
    (
      metadata.principals as Array<DatasetImportMetadata["principals"][number]>
    ).push({
      actor,
      kind: "user",
      legacyId: id,
      identity: kind,
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    });
  }
  const seenTokens = new Set<string>();
  for (const token of manifest.tokenOwners) {
    const actor = maps.tokens[token.id];
    if (!token.id || seenTokens.has(token.id) || !actor)
      throw Error("Ambiguous legacy token mapping");
    seenTokens.add(token.id);
    (
      metadata.principals as Array<DatasetImportMetadata["principals"][number]>
    ).push({
      actor,
      kind: "token",
      legacyId: token.id,
      identity: "user",
      expiresAt: null,
    });
  }
  for (const [legacyGroupId, actor] of Object.entries(maps.groups))
    (metadata.groups as Array<DatasetImportMetadata["groups"][number]>).push({
      owner: actor,
      legacyGroupId,
    });
  const artifacts = new Map<string, LegacyArtifact>();
  for (const row of manifest.artifacts) {
    if (!row.id || artifacts.has(row.id))
      throw Error("Duplicate source artifact");
    artifacts.set(row.id, row);
  }
  const versions = new Map<string, DatasetImportMetadata["versions"][number]>();
  const versionSource = new Map<string, string>();
  const addVersion = (row: LegacyRow, id: string) => {
    const key = JSON.stringify([id, row.version]);
    const source = canonical({
      format: row.format,
      source: row.source ?? null,
      meta: row.meta,
    });
    const prior = versionSource.get(key);
    if (prior !== undefined) {
      if (prior !== source)
        throw Error("Conflicting immutable dataset version");
      return;
    }
    versionSource.set(key, source);
    versions.set(key, catalogVersion(row, id, receipts));
  };
  for (const row of manifest.tables.artifact_versions ?? [])
    if (row.format === "dataset") {
      const id = String(row.artifact_id ?? "");
      if (!artifacts.has(id) || artifacts.get(id)!.format !== "dataset")
        throw Error("Orphan dataset version");
      addVersion(row, id);
    }
  for (const row of manifest.artifacts.filter((r) => r.format === "dataset")) {
    addVersion(row, row.id);
    const snapshot: DatasetSnapshot = {
      id: row.id,
      owner: principal(row),
      visibility: row.visibility,
      policyRevision: revision(row.policy_revision),
      ownerIsTestUser: users.get(String(row.user_id))?.kind === "testuser",
      policy: structuredClone(row.dataset_policy ?? null),
    };
    (
      metadata.resources as Array<DatasetImportMetadata["resources"][number]>
    ).push({
      legacyId: row.id,
      currentVersion: row.version,
      policyRevision: snapshot.policyRevision,
      owner: owner(row, maps),
      generation: 1,
      access: access(
        row,
        (manifest.tables.artifact_shares ?? []).filter(
          (s) => s.artifact_id === row.id,
        ),
        maps,
      ),
      deleted: !!row.deleted_at,
      snapshot,
    });
  }
  (metadata.versions as Array<DatasetImportMetadata["versions"][number]>).push(
    ...versions.values(),
  );
  const browserBindings: DatasetMetadataPlan["browserBindings"][number][] = [];
  const bindingKeys = new Set<string>();
  const pageKeys = new Set<string>();
  for (const b of input.bindings) {
    const page = artifacts.get(b.pageLegacyId);
    const dataset = artifacts.get(b.datasetLegacyId);
    const version = versions.get(
      JSON.stringify([b.datasetLegacyId, b.datasetVersion]),
    );
    if (
      !page ||
      page.format !== "markup" ||
      !dataset ||
      dataset.format !== "dataset" ||
      !version ||
      b.pageVersion !== page.version ||
      maps.pages[b.pageLegacyId] !== b.pageId ||
      !/^[A-Za-z0-9]{6}$/.test(b.pageId) ||
      !/^[A-Za-z0-9]{6}$/.test(b.backendId) ||
      !/^[a-f0-9]{64}$/.test(b.backendVersion) ||
      !/^[_A-Za-z][_0-9A-Za-z]*$/.test(b.backendNamespace) ||
      b.backendNamespace.startsWith("__") ||
      !b.name ||
      !b.legacyRef ||
      typeof page.edit_id !== "string" ||
      !page.edit_id
    )
      throw Error("Invalid or unresolved dataset binding");
    const key = JSON.stringify([
      b.pageId,
      b.pageVersion,
      b.backendId,
      b.backendVersion,
      b.name,
    ]);
    if (bindingKeys.has(key)) throw Error("Ambiguous dataset binding");
    bindingKeys.add(key);
    const pageKey = JSON.stringify([b.pageId, b.pageVersion]);
    const joins = (manifest.tables.relations ?? [])
      .filter(
        (r) =>
          r.subject_kind === "user" &&
          r.verb === "join" &&
          r.object_kind === "artifact" &&
          r.object_id === page.id &&
          r.status === "accepted",
      )
      .map((r) => String(r.subject_id));
    if (joins.some((id) => !users.has(id)))
      throw Error("Unmapped accepted dataset membership");
    if (!pageKeys.has(pageKey)) {
      pageKeys.add(pageKey);
      const snapshot: DocumentSnapshot = {
        id: page.id,
        editId: page.edit_id,
        owner: principal(page),
        visibility: page.visibility,
        format: "markup",
        deleted: !!page.deleted_at,
        ownerIsTestUser: users.get(String(page.user_id))?.kind === "testuser",
        acceptedJoinUserIds: joins,
      };
      (metadata.pages as Array<DatasetImportMetadata["pages"][number]>).push({
        pageId: b.pageId,
        pageVersion: b.pageVersion,
        snapshot,
      });
      for (const legacyUserId of joins)
        (
          metadata.acceptedJoins as Array<
            DatasetImportMetadata["acceptedJoins"][number]
          >
        ).push({ pageId: b.pageId, legacyUserId });
    }
    const current = metadata.resources.find(
      (r) => r.legacyId === b.datasetLegacyId,
    )!;
    (
      metadata.bindings as Array<DatasetImportMetadata["bindings"][number]>
    ).push({
      name: b.name,
      backendId: b.backendId,
      backendVersion: b.backendVersion,
      page: {
        id: b.pageId,
        version: b.pageVersion,
        legacyId: page.id,
        editId: page.edit_id,
      },
      dataset: {
        id: b.datasetLegacyId,
        version: b.datasetVersion,
        policyRevision: current.policyRevision,
      },
      tables: version.tables,
    });
    browserBindings.push({
      pageLegacyId: b.pageLegacyId,
      pageVersion: b.pageVersion,
      binding: {
        name: b.name,
        legacyRef: b.legacyRef,
        backendNamespace: b.backendNamespace,
        backendHref: "/af/v1/ids/" + b.backendId,
        version: b.datasetVersion,
        tables: version.tables.map((t) => ({
          schema: t.schema,
          table: t.name,
          columns: t.columns.map((c) => ({ ...c })),
        })),
      },
    });
  }
  return {
    metadata,
    browserBindings,
    provenance: {
      baseExportedAt: manifest.exportedAt,
      relationExportedAt: input.relationProvenance.exportedAt,
      relationManifestSha256: input.relationProvenance.manifestSha256,
    },
  };
}
