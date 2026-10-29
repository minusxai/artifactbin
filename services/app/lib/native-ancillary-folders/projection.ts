import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {NativeIdentityPlan} from '@/lib/native-identity-import';
import type {NativeAncillaryFolderRecipe,NativeAncillaryEncodedBytes,NativeLineageApproval,NativeLineageSelection} from './contracts';
type LegacyRow=Record<string,unknown>;
interface FolderIdentityPlan extends NativeIdentityPlan {artifactIds:Readonly<Record<string,string>>}
interface ProjectionInput {plan:FolderIdentityPlan;approvedPlanSha256:string;source:NativeAncillaryFolderRecipe['source'];approvals:readonly NativeLineageApproval[];identityGroups?:Readonly<Record<string,string>>}
const nativeDigest=(value:unknown):string=>{const canonical=(v:unknown):unknown=>{if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null))return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));throw Error('native_ancillary_non_json');};return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');};
function decodeNativePublicationBytes(value:NativeAncillaryEncodedBytes):Buffer {if(value.encoding!=='base64'||typeof value.data!=='string')throw Error('native_ancillary_encoding');const bytes=Buffer.from(value.data,'base64');if(bytes.toString('base64')!==value.data||createHash('sha256').update(bytes).digest('hex')!==value.sha256)throw Error('native_ancillary_source_digest');return bytes;}
function fail(code: string): never {
  throw Error("native_ancillary_" + code);
}
const parse = (value: Parameters<typeof decodeNativePublicationBytes>[0]) =>
  JSON.parse(Buffer.from(decodeNativePublicationBytes(value)).toString("utf8"));
const array = (value: unknown): LegacyRow[] => {
  if (
    !Array.isArray(value) ||
    value.some((v) => !v || typeof v !== "object" || Array.isArray(v))
  )
    fail("capture_shape");
  return value;
};
const fields = [
  "id",
  "token_id",
  "user_id",
  "group_id",
  "creator_user_id",
  "title",
  "description",
  "format",
  "source",
  "meta",
  "version",
  "created_at",
  "updated_at",
  "edit_id",
  "visibility",
  "access",
  "actor_user_id",
  "actor_token_id",
  "link_role",
  "ancestor_ids",
  "deleted_at",
  "dataset_policy",
  "sharing_revision",
  "policy_revision",
  "document",
  "document_archived_at",
] as const;
/** Explicit successor configuration only. Import authority/existence comes from the actual product stage. */
function project(
  raw: ProjectionInput,
) {
  const input = structuredClone(raw),
    parent = input.plan,
    { sha256: parentSha, ...parentBody } = parent;
  if (
    input.approvedPlanSha256 !== parentSha ||
    nativeDigest(parentBody) !== parentSha ||
    parent.blockers.length
  )
    fail("parent_plan_changed");
  if (
    nativeDigest(input.source.sourceInventory) !==
      parent.sourceInventorySha256 ||
    nativeDigest(input.source.targetInventory) !== parent.targetInventorySha256
  )
    fail("inventory_changed");
  const manifest = parse(input.source.selectionManifest),
    census = parse(input.source.datasetCensus),
    capture = parse(input.source.capture);
  const { sha256: censusSha, ...censusBody } = census;
  if (
    nativeDigest(censusBody) !== censusSha ||
    census.mode !== "latest-only" ||
    census.selectionManifestSha256 !== input.source.selectionManifest.sha256
  )
    fail("selection_changed");
  const pages = array(manifest.receipts).map((row) => String(row.id)),
    censusPages = array(census.pages).map((row) => String(row.id));
  const datasets = array(census.datasets);
  if (
    pages.length !== 393 ||
    new Set(pages).size !== 393 ||
    datasets.length !== 190 ||
    new Set(datasets.map((d) => d.id)).size !== 190 ||
    nativeDigest([...pages].sort()) !== nativeDigest([...censusPages].sort()) ||
    census.selectedHeads !== 393
  )
    fail("selection_scope");
  for (const dataset of datasets)
    if (
      !dataset.row ||
      typeof dataset.row !== "object" ||
      dataset.id !== (dataset.row as LegacyRow).id ||
      dataset.version !== (dataset.row as LegacyRow).version ||
      dataset.rowSha256 !== nativeDigest(dataset.row) ||
      (dataset.row as LegacyRow).format !== "dataset"
    )
      fail("dataset_current_changed");
  const selection: NativeLineageSelection = {
    selectionSha256: input.source.selectionManifest.sha256,
    datasetCensusSha256: input.source.datasetCensus.sha256,
    pageSourceIdsSha256: nativeDigest([...pages].sort()),
    datasetSourceIdsSha256: nativeDigest(
      datasets.map((d) => String(d.id)).sort(),
    ),
    pageCount: 393,
    datasetCount: 190,
  };
  if (capture.snapshot?.[0]?.read_only !== "on") fail("capture_not_readonly");
  const folders = array(capture.folders),
    shares = array(capture.shares),
    sourceInventory = array(input.source.sourceInventory.artifacts),
    targetArtifacts = array(input.source.targetInventory.artifacts),
    targetReservations = array(input.source.targetInventory.reservations);
  if (
    !folders.length ||
    folders.length > 256 ||
    folders.length !== input.approvals.length ||
    new Set(folders.map((row) => row.id)).size !== folders.length ||
    new Set(input.approvals.map((row) => row.sourceId)).size !==
      input.approvals.length
  )
    fail("folder_scope");
  const artifactIds = { ...parent.artifactIds },
    targets = new Set(Object.values(artifactIds));
  for (const approval of input.approvals) {
    const { sha256, ...body } = approval;
    if (
      nativeDigest(body) !== sha256 ||
      approval.identityPlanSha256 !== parentSha ||
      approval.sourceInventorySha256 !== parent.sourceInventorySha256 ||
      approval.targetInventorySha256 !== parent.targetInventorySha256 ||
      !approval.approvedBy ||
      !approval.reason ||
      approval.sourceId !== approval.targetId ||
      approval.targetArtifactCollision !== false ||
      approval.targetReservationCollision !== false ||
      approval.importAncestor !== false
    )
      fail("approval_changed");
    const witness = sourceInventory.filter(
      (row) => row.id === approval.sourceId,
    );
    if (
      witness.length !== 1 ||
      nativeDigest(witness[0]) !== approval.sourceRowSha256
    )
      fail("folder_inventory_changed");
    if (
      Object.hasOwn(artifactIds, approval.sourceId) ||
      targets.has(approval.targetId) ||
      pages.includes(approval.sourceId) ||
      datasets.some((row) => row.id === approval.sourceId)
    )
      fail("folder_scope");
    if (
      targetArtifacts.some((row) => row.id === approval.targetId) ||
      targetReservations.some((row) => row.id === approval.targetId)
    )
      fail("target_collision");
    artifactIds[approval.sourceId] = approval.targetId;
    targets.add(approval.targetId);
  }
  const nextBody = { ...parentBody, artifactIds },
    plan = { ...nextBody, sha256: nativeDigest(nextBody) };
  function mapped(
    kind: "users" | "tokens" | "groups" | "artifacts",
    id: unknown,
  ): string | null {
    if (id === null || id === undefined) return null;
    if (typeof id !== "string") fail("identity_unmapped");
    const value =
      kind === "artifacts"
        ? artifactIds[id]
        : kind === "groups"
          ? input.identityGroups?.[id]
          : kind === "users"
            ? plan.targets.users[id]?.userId
            : plan.targets.tokens[id]?.tokenId;
    if (!value) fail("identity_unmapped");
    return value;
  }
  const seenShares = new Set<string>();
  for (const share of shares) {
    if (
      !folders.some((row) => row.id === share.artifact_id) ||
      typeof share.email !== "string" ||
      !share.email.includes("@") ||
      !["viewer", "commenter", "editor"].includes(String(share.role))
    )
      fail("share_scope");
    const key = JSON.stringify([
      share.artifact_id,
      share.email.trim().toLowerCase(),
    ]);
    if (seenShares.has(key)) fail("share_duplicate");
    seenShares.add(key);
  }
  const projected: NativeAncillaryFolderRecipe["folders"][number][] = folders
    .sort(
      (a, b) =>
        (a.ancestor_ids as unknown[]).length -
        (b.ancestor_ids as unknown[]).length,
    )
    .map((source) => {
      const approval = input.approvals.find(
        (row) => row.sourceId === source.id,
      );
      if (!approval) fail("folder_approval_missing");
      const witness = sourceInventory.find((row) => row.id === source.id)!;
      if (
        source.format !== "folder" ||
        source.deleted_at !== null ||
        source.document !== null ||
        source.dataset_policy !== null ||
        source.forked_from !== null ||
        source.generation_calls !== 0 ||
        !source.meta ||
        typeof source.meta !== "object" ||
        Array.isArray(source.meta) ||
        (source.meta as LegacyRow).nativeAncillaryFolder ||
        !Array.isArray(source.ancestor_ids) ||
        new Set(source.ancestor_ids).size !== source.ancestor_ids.length ||
        source.ancestor_ids.includes(source.id) ||
        [
          "format",
          "user_id",
          "token_id",
          "group_id",
          "version",
          "deleted_at",
        ].some(
          (key) => nativeDigest(source[key]) !== nativeDigest(witness[key]),
        )
      )
        fail("folder_source_changed");
      const requiredBy = datasets.filter(
        (dataset) =>
          Array.isArray((dataset.row as LegacyRow).ancestor_ids) &&
          ((dataset.row as LegacyRow).ancestor_ids as unknown[]).includes(
            source.id,
          ),
      );
      if (!requiredBy.length) fail("folder_unreferenced");
      for (const dataset of requiredBy) {
        const row = dataset.row as LegacyRow,
          ancestors = row.ancestor_ids as string[];
        if (
          source.user_id !== row.user_id ||
          source.group_id !== row.group_id ||
          (!source.user_id &&
            !source.group_id &&
            source.token_id !== row.token_id) ||
          nativeDigest(source.ancestor_ids) !==
            nativeDigest(
              ancestors.slice(0, ancestors.indexOf(String(source.id))),
            )
        )
          fail("folder_hierarchy");
      }
      const row: LegacyRow = Object.fromEntries(
        fields.map((field) => [field, source[field]]),
      );
      row.id = mapped("artifacts", source.id);
      for (const field of ["user_id", "creator_user_id", "actor_user_id"])
        row[field] = mapped("users", source[field]);
      for (const field of ["token_id", "actor_token_id"])
        row[field] = mapped("tokens", source[field]);
      row.group_id = mapped("groups", source.group_id);
      row.ancestor_ids = source.ancestor_ids.map((id) =>
        mapped("artifacts", id),
      );
      row.meta = {
        ...(source.meta as LegacyRow),
        nativeAncillaryFolder: {
          sourceNamespace: plan.sourceNamespace,
          sourceId: source.id,
          sourceSha256: input.source.capture.sha256,
          identityPlanSha256: plan.sha256,
        },
      };
      const projectedShares = shares
        .filter((share) => share.artifact_id === source.id)
        .map((share) => ({
          email: String(share.email).trim().toLowerCase(),
          role: String(share.role),
          ...(Object.hasOwn(share, "user_id")
            ? { userId: mapped("users", share.user_id) }
            : {}),
          ...(Object.hasOwn(share, "created_at")
            ? { createdAt: String(share.created_at) }
            : {}),
        }))
        .sort((a, b) => a.email.localeCompare(b.email));
      return {
        sourceId: String(source.id),
        targetId: approval.targetId,
        sourceRowSha256: nativeDigest(source),
        sourceInventoryRowSha256: approval.sourceRowSha256,
        requiredBy: requiredBy.map((dataset) => String(dataset.id)).sort(),
        row,
        shares: projectedShares,
      };
    });
  const ancillaryBody = {
    schema: "native-reviewed-ancillary-folders-v1" as const,
    sourceNamespace: plan.sourceNamespace,
    parentIdentityPlanSha256: parentSha,
    identityPlanSha256: plan.sha256,
    ...(input.identityGroups ? { identityGroups: input.identityGroups } : {}),
    selection,
    source: input.source,
    approvals: input.approvals,
    folders: projected,
  };
  const ancillaryFolders = {
      ...ancillaryBody,
      sha256: nativeDigest(ancillaryBody),
    },
    body = {
      plan,
      parentIdentityPlanSha256: parentSha,
      approvedPlanSha256: plan.sha256,
      selection,
      ancillaryFolders,
    };
  return { ...body, sha256: nativeDigest(body) };
}

/** Rebuild the reviewed projection independently from retained raw captures. */
export function verifyAncillaryRecipe(raw:NativeAncillaryFolderRecipe,rawPlan:NativeIdentityPlan,groups:Readonly<Record<string,string>>){
 const recipe=structuredClone(raw),plan=structuredClone(rawPlan) as FolderIdentityPlan;
 const {sha256,...body}=recipe;if(nativeDigest(body)!==sha256||recipe.schema!=='native-reviewed-ancillary-folders-v1')throw Error('native_ancillary_recipe_digest');
 const {sha256:planSha,...planBody}=plan;if(nativeDigest(planBody)!==planSha||recipe.identityPlanSha256!==planSha||recipe.sourceNamespace!==plan.sourceNamespace)throw Error('native_ancillary_plan_digest');
 if(!plan.artifactIds||typeof plan.artifactIds!=='object'||Array.isArray(plan.artifactIds))throw Error('native_ancillary_plan_mapping');
 const artifactIds={...plan.artifactIds};for(const folder of recipe.folders){if(artifactIds[folder.sourceId]!==folder.targetId)throw Error('native_ancillary_plan_mapping');delete artifactIds[folder.sourceId];}
 const parentBody={...planBody,artifactIds},parent={...parentBody,sha256:nativeDigest(parentBody)} as FolderIdentityPlan;
 if(parent.sha256!==recipe.parentIdentityPlanSha256)throw Error('native_ancillary_parent_plan');
 if(recipe.identityGroups!==undefined&&!isDeepStrictEqual(recipe.identityGroups,groups))throw Error('native_ancillary_group_mapping');
 const rebuilt=project({plan:parent,approvedPlanSha256:parent.sha256,source:recipe.source,approvals:recipe.approvals,...(recipe.identityGroups!==undefined?{identityGroups:groups}:{})});
 if(!isDeepStrictEqual(rebuilt.plan,plan)||!isDeepStrictEqual(rebuilt.ancillaryFolders,recipe))throw Error('native_ancillary_projection_changed');
 return recipe;
}
