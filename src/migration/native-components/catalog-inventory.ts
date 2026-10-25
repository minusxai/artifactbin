import { nativeDigest } from "./selection.ts";
import { decodeNativePublicationBytes } from "./pipeline-publication.ts";
import type { BuildNativeCatalogInventory } from "./catalog-inventory-contracts.ts";
import type { NativePublicationCatalog } from "./pipeline-publication-contracts.ts";
function fail(code: string): never {
  throw Error("native_catalog_inventory_" + code);
}
const digest = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const parse = (bytes: Parameters<typeof decodeNativePublicationBytes>[0]) =>
  JSON.parse(Buffer.from(decodeNativePublicationBytes(bytes)).toString("utf8"));
/** Pure current-catalog inventory producer. Target staging independently verifies the same raw source evidence. */
export const buildNativeCatalogInventory: BuildNativeCatalogInventory = (
  raw,
) => {
  const input = structuredClone(raw);
  if (
    input.captures.length > 512 ||
    input.metadata.length > 512 ||
    input.typedUserRemaps.length > 4096 ||
    input.externalConnections.length > 512 ||
    ![
      input.selectionSha256,
      input.sourceManifestSha256,
      input.identityPlan.sha256,
    ].every(digest) ||
    input.identityPlan.sourceNamespace !== input.sourceNamespace
  )
    fail("input_invalid");
  const identities = {
    users: Object.fromEntries(
      Object.entries(input.identityPlan.targets.users).map(([id, target]) => [
        id,
        target.userId,
      ]),
    ),
    tokens: Object.fromEntries(
      Object.entries(input.identityPlan.targets.tokens).map(([id, target]) => [
        id,
        target.tokenId,
      ]),
    ),
    groups: input.identityGroups ?? {},
    artifacts: input.identityPlan.artifactIds,
  };
  function mapped(
    kind: keyof typeof identities,
    value: unknown,
  ): string | null {
    if (
      value === null ||
      value === undefined ||
      (kind === "tokens" && value === "")
    ) return null;
    if (
      typeof value !== "string" ||
      !Object.hasOwn(identities[kind], value) ||
      !identities[kind][value]
    )
      fail("identity_unmapped");
    return identities[kind][value]!;
  }
  function iso(value: unknown): string {
    const epoch = Date.parse(String(value));
    if (!Number.isFinite(epoch)) fail("date_invalid");
    return new Date(epoch).toISOString();
  }
  function policy(value: unknown): unknown {
    const copy = structuredClone(value) as any;
    if (copy?.version === 2)
      for (const grant of copy.allow ?? [])
        for (const [field, subject] of Object.entries(grant.from ?? {}))
          if (subject !== "*" && subject !== "$owner")
            grant.from[field] = mapped(
              field === "artifact" ? "artifacts" : "users",
              subject,
            );
    return copy;
  }
  function metadata(meta: Record<string, unknown>): Record<string, unknown> {
    const copy = structuredClone(meta),
      catalog = copy.catalog as
        | { tables?: { columns?: unknown }[] }
        | undefined;
    const columns = (value: unknown) => {
      if (!Array.isArray(value)) return;
      for (const column of value) {
        const scopes = column?.constraints?.memberOf;
        if (Array.isArray(scopes))
          column.constraints.memberOf = scopes.map((ref: unknown) => {
            if (ref === "current") return ref;
            if (typeof ref !== "string" || !ref.startsWith("ref:"))
              fail("metadata_scope_invalid");
            return "ref:" + mapped("artifacts", ref.slice(4));
          });
      }
    };
    columns(copy.columns);
    for (const table of catalog?.tables ?? []) columns(table.columns);
    if (typeof copy.userScopeDocument === "string")
      copy.userScopeDocument = mapped("artifacts", copy.userScopeDocument);
    return copy;
  }
  const sourceIds = new Set<string>(),
    targets = new Set<string>(),
    neededObjects = new Set<string>();
  const datasets: NativePublicationCatalog["projection"]["datasets"][number][] =
      [],
    receipts: Record<string, NativePublicationCatalog["receipts"][string]> = {};
  for (const capture of input.captures) {
    if (
      sourceIds.has(capture.sourceId) ||
      !digest(capture.headSha256) ||
      !digest(capture.catalogSha256) ||
      !digest(capture.policySha256)
    )
      fail("head_invalid");
    sourceIds.add(capture.sourceId);
    const source = parse(capture.source.bytes),
      relations = parse(capture.relations.bytes);
    const heads = (source.heads ?? []).filter(
      (row: any) => row.id === capture.sourceId,
    );
    if (heads.length !== 1) fail("head_missing");
    const head = heads[0];
    if (
      head.format !== "dataset" ||
      head.version !== capture.version ||
      !Number.isSafeInteger(head.version) ||
      head.version < 1 ||
      nativeDigest(head) !== capture.headSha256 ||
      !record(head.meta) ||
      nativeDigest(head.meta.catalog) !== capture.catalogSha256 ||
      nativeDigest({
        datasetPolicy: head.dataset_policy,
        policyRevision: head.policy_revision,
        sharingRevision: head.sharing_revision,
        visibility: head.visibility,
        owner: head.user_id,
      }) !== capture.policySha256
    )
      fail("head_changed");
    const relationHeads = (relations.heads ?? []).filter(
      (row: any) => row.id === capture.sourceId,
    );
    if (
      relationHeads.length !== 1 ||
      relationHeads[0].version !== head.version ||
      iso(relationHeads[0].updated_at) !== iso(head.updated_at) ||
      !Array.isArray(relations.artifact_shares) ||
      !Array.isArray(relations.dataset_policy_audit)
    )
      fail("relation_head_changed");
    const targetId = mapped("artifacts", capture.sourceId);
    if (!targetId || targets.has(targetId)) fail("identity_target_invalid");
    targets.add(targetId);
    const originalMeta = head.meta as Record<string, unknown>,
      catalog = originalMeta.catalog as {
        kind?: string;
        tables?: { objectKey?: string }[];
      };
    if (
      !catalog ||
      !["stored", "postgres"].includes(String(catalog.kind)) ||
      !Array.isArray(catalog.tables)
    )
      fail("catalog_kind_unsupported");
    if (typeof originalMeta.objectKey === "string")
      neededObjects.add(originalMeta.objectKey);
    for (const table of catalog.tables)
      if (typeof table.objectKey === "string")
        neededObjects.add(table.objectKey);
    const matches = input.metadata.filter(
      (m) => m.sourceId === capture.sourceId,
    );
    if (matches.length > 1) fail("metadata_duplicate");
    let selectedMeta = originalMeta;
    if (matches.length) {
      const proof = matches[0]!;
      if (
        proof.version !== head.version ||
        proof.sourceRowSha256 !== capture.headSha256 ||
        proof.sourceMetaSha256 !== nativeDigest(originalMeta) ||
        proof.targetMetaSha256 !== nativeDigest(proof.meta)
      )
        fail("metadata_changed");
      selectedMeta = proof.meta;
    }
    const connections = input.externalConnections.filter(
      (c) => c.datasetSourceId === capture.sourceId,
    );
    if (
      catalog.kind === "postgres"
        ? connections.length !== 1 ||
          !digest(connections[0]!.sourceSecretSha256)
        : connections.length !== 0
    )
      fail("external_receipt_missing");
    const version = {
      version: head.version,
      sourceSha256: capture.headSha256,
      source: head.source ?? null,
      meta: metadata(selectedMeta),
      title: head.title ?? null,
      description: head.description ?? null,
      createdAt: iso(head.updated_at),
      actorUserId: mapped("users", head.actor_user_id),
      actorTokenId: mapped("tokens", head.actor_token_id),
    };
    const authority = {
      tokenId: mapped("tokens", head.token_id),
      userId: mapped("users", head.user_id),
      groupId: mapped("groups", head.group_id),
      creatorUserId: mapped("users", head.creator_user_id),
      ancestorIds: (head.ancestor_ids ?? []).map((id: unknown) =>
        mapped("artifacts", id),
      ),
      visibility: head.visibility,
      linkRole: head.link_role ?? "viewer",
      access: head.access ?? "read",
      datasetPolicy: policy(head.dataset_policy ?? null),
      sharingRevision: Number(head.sharing_revision ?? 0),
      policyRevision: Number(head.policy_revision ?? 0),
      editId: head.edit_id,
      createdAt: iso(head.created_at),
      updatedAt: iso(head.updated_at),
      deletedAt: head.deleted_at ? iso(head.deleted_at) : null,
      shares: relations.artifact_shares
        .filter((row: any) => row.artifact_id === capture.sourceId)
        .map(({ email, role }: any) => ({ email, role })),
    };
    if (!authority.tokenId) fail("identity_token_missing");
    const policyAudit = relations.dataset_policy_audit
      .filter(
        (row: any) =>
          row.dataset_id === capture.sourceId &&
          row.revision === authority.policyRevision,
      )
      .map((row: any) => ({
        revision: row.revision,
        policy: policy(row.policy),
        actorUserId: mapped("users", row.actor_user_id),
        actorTokenId: mapped("tokens", row.actor_token_id),
        createdAt: iso(row.created_at),
      }));
    datasets.push({
      sourceId: capture.sourceId,
      targetId,
      sourceSha256: capture.source.bytes.sha256,
      relationsSha256: capture.relations.bytes.sha256,
      currentVersion: head.version,
      expectedVersions: [head.version],
      versions: [version],
      authority,
      policyAudit,
    });
    receipts[capture.sourceId] = {
      path: capture.source.path,
      sha256: capture.source.bytes.sha256,
      relations: {
        path: capture.relations.path,
        sha256: capture.relations.bytes.sha256,
      },
    };
  }
  for (const proof of [...input.metadata, ...input.typedUserRemaps]) {
    const dataset = datasets.find((d) => d.sourceId === proof.sourceId);
    if (!dataset || proof.version !== dataset.currentVersion)
      fail("historical_metadata_forbidden");
  }
  if (
    input.typedUserRemaps.some(
      (proof) => proof.identityPlanSha256 !== input.identityPlan.sha256,
    )
  )
    fail("remap_identity_changed");
  if (
    input.externalConnections.some(
      (proof) => !sourceIds.has(proof.datasetSourceId),
    )
  )
    fail("external_source_missing");
  const ledger = parse(input.objectLedger);
  if (!Array.isArray(ledger)) fail("object_ledger_invalid");
  const objects = new Map<
    string,
    {
      objectKey: string;
      targetKey: string;
      status: "copied";
      sha256: string;
      bytes: number;
      contentType?: string;
    }
  >();
  for (const row of ledger) {
    if (row.status !== "copied" || !neededObjects.has(row.objectKey)) continue;
    if (
      !digest(row.sha256) ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 0
    )
      fail("object_receipt_invalid");
    const value = {
      objectKey: row.objectKey,
      targetKey: row.objectKey,
      status: "copied" as const,
      sha256: row.sha256,
      bytes: row.bytes,
      ...(row.contentType ? { contentType: row.contentType } : {}),
    };
    const prior = objects.get(row.objectKey);
    if (prior && nativeDigest(prior) !== nativeDigest(value))
      fail("object_ambiguous");
    objects.set(row.objectKey, value);
  }
  if (objects.size !== neededObjects.size) fail("object_missing");
  const payload = {
    revisionScope: "latest" as const,
    identityPlanSha256: input.identityPlan.sha256,
    imports: [],
    identities,
    sourceNamespace: input.sourceNamespace,
    selectionSha256: input.selectionSha256,
    sourceManifestSha256: input.sourceManifestSha256,
    objectManifestSha256: input.objectLedger.sha256,
    datasets,
    objects: [...objects.values()],
    typedUserRemaps: input.typedUserRemaps,
    externalConnections: input.externalConnections,
  };
  return {
    projection: { ...payload, sha256: nativeDigest(payload) },
    root: input.root,
    ledgerPath: input.ledgerPath,
    receipts,
    sinkDirectory: input.sinkDirectory,
  };
};
