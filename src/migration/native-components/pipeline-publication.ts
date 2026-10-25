import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { planMigration } from "../import.ts";
import { canonicalMigrationValue } from "../verification-values.ts";
import { nativeDigest } from "./selection.ts";
import { resolveNativeIdentityComment } from "./identity.ts";
import { mapNativeCommentAuthorIdentity, mapNativeCommentImageActorIdentity } from "./comment-author-provenance.ts";
import {nativeCommentTextSegment} from './comment-text-segment.ts';
import {nativeCommentAnchorHasContinuity} from './comment-anchor-continuity.ts';
import {
  projectNativeV3Publication,
  projectNativeV3RelationBindings,
} from "./v3-publication-projection.ts";
import type { LegacyArtifact, LegacyRow } from "../contracts.ts";
import type {
  NativePublicationBytes,
  NativePublicationInput,
  NativePublicationHost,
  NativePublicationResult,
  NativePublicationCatalogImport,
  NativePublicationCommentAnchor,
} from "./pipeline-publication-contracts.ts";
function fail(code: string): never {
  throw Error("native_publication_" + code);
}
export function encodeNativePublicationBytes(
  bytes: Uint8Array,
): NativePublicationBytes {
  return {
    encoding: "base64",
    data: Buffer.from(bytes).toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
export function decodeNativePublicationBytes(
  value: NativePublicationBytes,
): Uint8Array {
  if (
    value.encoding !== "base64" ||
    typeof value.data !== "string" ||
    value.data.length > 64 * 1024 * 1024
  )
    fail("capture_invalid");
  const bytes = Buffer.from(value.data, "base64");
  if (
    bytes.toString("base64") !== value.data ||
    createHash("sha256").update(bytes).digest("hex") !== value.sha256
  )
    fail("capture_changed");
  return bytes;
}
/** Build a latest-only product recipe from shared evidence and the actual assembled source. No writes. */
export async function prepareNativePublication(
  rawInput: NativePublicationInput,
  host: NativePublicationHost,
): Promise<NativePublicationResult> {
  const input = structuredClone(rawInput),
    { selection, shared } = input,
    page = selection.page;
  const heads = page.revisions.filter(
    (r) => r.key.version === page.headVersion,
  );
  if (
    heads.length !== 1 ||
    input.assemblies.length !== 1 ||
    input.assemblies[0]!.key.sourceId !== page.sourceId ||
    input.assemblies[0]!.key.version !== page.headVersion ||
    input.assemblies[0]!.key.sourceNamespace !== selection.sourceNamespace
  )
    fail("selected_head_required");
  const head = heads[0]!,
    assembly = input.assemblies[0]!;
  if (
    head.rowSha256 !== nativeDigest(head.original) ||
    head.documentSha256 !== nativeDigest(head.original.document) ||
    assembly.input.analysis.documentSha256 !== head.documentSha256 ||
    assembly.result.status !== "complete"
  )
    fail("source_changed");
  const identity = shared.identity;
  if (
    identity.approvedPlanSha256 !== identity.plan.sha256 ||
    identity.plan.sourceNamespace !== selection.sourceNamespace ||
    !isDeepStrictEqual(identity.plan.targets, shared.targets) ||
    !isDeepStrictEqual(identity.plan.artifactIds, shared.maps.pages)
  )
    fail("identity_binding");
  const raw = JSON.parse(
    Buffer.from(decodeNativePublicationBytes(input.relations)).toString("utf8"),
  ) as Record<string, unknown>;
  const tables: Record<string, LegacyRow[]> = {};
  for (const [key, value] of Object.entries(raw))
    if (Array.isArray(value)) tables[key] = value;
  tables.artifact_versions = [];
  const annotationIds = new Set((tables.annotations ?? [])
    .filter(a => a.artifact_id === page.sourceId).map(a => a.id));
  const images = (tables.annotation_images ?? tables.comment_images ?? [])
    .filter(a => annotationIds.has(a.annotation_id))
    .map(a => ({
      id: a.id,
      annotationId: a.annotation_id,
      ...mapNativeCommentImageActorIdentity(shared.targets, a.user_id, a.token_id),
      metadata: a.metadata,
      bytes: Number(a.bytes),
      ready: a.ready,
      expiresAt: a.expires_at,
    }));
  const plan = await planMigration(
    {
      schemaVersion: 1,
      sourceNamespace: selection.sourceNamespace,
      exportedAt: input.exportedAt,
      tables,
      artifacts: [head.original as LegacyArtifact],
      tokenOwners: [...shared.tokenOwners],
    },
    {
      maps: shared.maps,
      coreUrl: input.coreUrl,
      convert(source) {
        if (nativeDigest(source.document) !== head.documentSha256)
          fail("conversion_source_changed");
        return {
          classification: "functional",
          html:
            assembly.result.status === "complete" ? assembly.result.html : null,
          issues: [],
          identities: Object.fromEntries(
            assembly.input.identity.bindings.map((b) => [b.sourceNode, b.afId]),
          ),
        };
      },
    },
  );
  if (
    plan.pages.length !== 1 ||
    plan.pages[0]!.legacyId !== page.sourceId ||
    plan.pages[0]!.disposition !== "ready" ||
    plan.pages[0]!.issues.length
  )
    fail("planner_blocked");
  const planned = plan.pages[0]!;
  if (
    planned.revisions.length !== 1 ||
    planned.revisions[0]!.version !== page.headVersion
  )
    fail("history_forbidden");
  const projection = {
    revisionScope: "latest" as const,
    selection,
    planned,
    plannedSha256: createHash("sha256")
      .update(canonicalMigrationValue(planned))
      .digest("hex"),
    maps: shared.maps,
    targets: shared.targets,
    targetIdentitySha256: nativeDigest(shared.targets),
    assemblies: input.assemblies,
  };
  const actualHost = await host.prepare(input.assemblies, planned);
  const history = projectNativeV3Publication(projection, actualHost),
    bindings = projectNativeV3RelationBindings(projection, history, actualHost);
  const annotations = (tables.annotations ?? []).filter(
    (a) => a.artifact_id === page.sourceId,
  );
  if (new Set(annotations.map((a) => a.id)).size !== annotations.length)
    fail("comment_duplicate");
  const sorted = [...annotations].sort(
    (a, b) =>
      Number(a.root_id !== null) - Number(b.root_id !== null) ||
      (BigInt(String(a.seq ?? 0)) < BigInt(String(b.seq ?? 0))
        ? -1
        : BigInt(String(a.seq ?? 0)) > BigInt(String(b.seq ?? 0))
          ? 1
          : 0),
  );
  const rootAnchor = (
    root: LegacyRow,
  ): NativePublicationCommentAnchor | null => {
    if (typeof root.anchor_key !== 'string' || !nativeCommentAnchorHasContinuity({sourceId:page.sourceId,headVersion:page.headVersion,anchorVersion:root.anchor_version,anchorKey:root.anchor_key,allocations:tables.artifact_source_ids??[]}))
      return null;
    const quote = root.quote ?? "";
    if (
      typeof quote !== "string" ||
      quote.length > 32768 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(quote)
    )
      return null;
    // Retained annotation keys explicitly name authored DOM IDs. Never guess
    // a graph key or text match when that ID is absent. An older annotation
    // additionally requires captured allocation continuity, never an old page.
    let target;
    try {
      target = resolveNativeIdentityComment([assembly.input.identity], {
        key: assembly.key,
        target: { kind: "dom", value: root.anchor_key },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "native_identity_comment_target"
      )
        return null;
      throw error;
    }
    if (
      !bindings.some(
        (binding) =>
          binding.version === page.headVersion &&
          binding.sourceNodeId === target.sourceNode &&
          binding.nodeId === target.afId,
      )
    )
      return null;
    const segments=assembly.result.status === "complete" ? nativeCommentTextSegment({html:assembly.result.html,nodeId:target.afId,sourceNodeId:target.sourceNode,legacyRange:root.range}) : undefined;
    return {
      version: page.headVersion,
      sourceNamespace: selection.sourceNamespace,
      sourceNodeId: target.sourceNode,
      quote,
      ...(segments ? {segments} : {}),
    };
  };
  const projected = sorted.map((a) => {
    const root =
      a.root_id === null
        ? a
        : annotations.find((r) => r.id === a.root_id && r.root_id === null);
    if (!root) fail("comment_root_missing");
    const retained = page.revisions.some(
      (r) => r.key.version === root.anchor_version,
    );
    const attachment = rootAnchor(root);
    const author = mapNativeCommentAuthorIdentity(
      shared.targets,
      a.author_user_id,
      a.author_token_id,
    );
    const fields = {
      id: a.id,
      revision: a.revision,
      rootId: a.root_id,
      body: a.body,
      authorKind: a.author_kind,
      ...author,
      authorLabel: a.author_label,
      authorTransport: a.author_transport,
      status: a.status,
      resolvedAt: a.resolved_at,
      createdAt: a.created_at,
      editedAt: a.edited_at,
      deletedAt: a.deleted_at,
      changeSeq: a.change_seq,
      authorRemote: a.author_remote,
      snippet: a.snippet,
      quote: a.quote,
      range: a.range,
      viewState: a.view_state,
    };
    return {
      ...fields,
      anchor: a.root_id === null ? attachment : null,
      retainedContext: {
        sourceNamespace: selection.sourceNamespace,
        sourceId: page.sourceId,
        originalRevision: root.anchor_version,
        originalAnchorKey: root.anchor_key,
        targetVersionMigrated: root.anchor_version === page.headVersion,
        sourceVersionRetained: retained,
        status: attachment
          ? "attached-source"
          : retained
            ? "orphaned-source"
            : "unavailable-version",
        reason: attachment
          ? "mapped-source-id"
          : retained
            ? "retired-or-unmapped-anchor"
            : "not-retained",
        sourceAnnotation: a,
        raw: {
          anchor_key: a.anchor_key,
          anchor_version: a.anchor_version,
          quote: a.quote,
          range: a.range,
          view_state: a.view_state,
        },
      },
    };
  });
  const imports: NativePublicationCatalogImport[] = history.revisions.flatMap(
    (revision) =>
      revision.queries.flatMap((prepared) => {
        const program = assembly.programs.find(
          (p) => p.kind === "query" && p.namespace === prepared.link.name,
        );
        if (!program || program.kind !== "query") fail("query_program_missing");
        return program.program.imports.map((i) => ({
          pageId: history.pageId,
          pageVersion: revision.page.version,
          backendId: prepared.link.backendId,
          backendVersion: prepared.link.version,
          alias: i.alias,
          datasetId: i.binding,
          table: i.table,
        }));
      }),
  );
  const needed = new Set([
    ...imports.map((i) => i.datasetId),
    ...assembly.programs.flatMap((p) =>
      p.kind === "query"
        ? p.program.queries.flatMap((q) => (q.source ? [q.source] : []))
        : [p.program.target.datasetId],
    ),
    ...history.revisions.flatMap((r) =>
      r.page.links.flatMap((l) => (l.kind === "dataset" ? [l.datasetId] : [])),
    ),
  ]);
  const catalog = shared.catalog,
    { sha256: catalogSha, ...catalogBody } = catalog.projection;
  if (
    nativeDigest(catalogBody) !== catalogSha ||
    catalogBody.revisionScope !== "latest" ||
    catalogBody.sourceNamespace !== selection.sourceNamespace ||
    catalogBody.selectionSha256 !== selection.manifestSha256 ||
    catalogBody.identityPlanSha256 !== identity.plan.sha256
  )
    fail("catalog_binding");
  const expectedIdentities = {
    users: Object.fromEntries(
      Object.entries(shared.targets.users).map(([id, target]) => [
        id,
        target.userId,
      ]),
    ),
    tokens: Object.fromEntries(
      Object.entries(shared.targets.tokens).map(([id, target]) => [
        id,
        target.tokenId,
      ]),
    ),
    groups: shared.identityGroups ?? {},
    artifacts: identity.plan.artifactIds,
  };
  if (!isDeepStrictEqual(catalogBody.identities, expectedIdentities))
    fail("catalog_identity_binding");
  const datasets = catalogBody.datasets.filter((d) => needed.has(d.targetId));
  if (
    datasets.length !== needed.size ||
    datasets.some(
      (d) =>
        d.expectedVersions.length !== 1 ||
        d.expectedVersions[0] !== d.currentVersion ||
        d.versions.length !== 1 ||
        d.versions[0]!.version !== d.currentVersion,
    )
  )
    fail("catalog_current_missing");
  const sourceIds = new Set(datasets.map((d) => d.sourceId)),
    keys = new Set<string>();
  for (const dataset of datasets)
    for (const version of dataset.versions) {
      const meta = version.meta;
      if (typeof meta.objectKey === "string") keys.add(meta.objectKey);
      const tables =
        (meta.catalog as { tables?: { objectKey?: string }[] } | undefined)
          ?.tables ?? [];
      for (const table of tables)
        if (typeof table.objectKey === "string") keys.add(table.objectKey);
    }
  // Derived typed-user metadata names target objects; immutable source bytes still
  // belong in the selected closure so target staging can verify the remap.
  for (const remap of catalogBody.typedUserRemaps ?? [])
    if (
      sourceIds.has(remap.sourceId) &&
      typeof remap.sourceObjectKey === "string"
    )
      keys.add(remap.sourceObjectKey);
  const selectedCatalog = {
    ...catalogBody,
    datasets,
    objects: catalogBody.objects.filter((o) => keys.has(o.objectKey)),
    imports,
    ...(catalogBody.typedUserRemaps
      ? {
          typedUserRemaps: catalogBody.typedUserRemaps.filter((r) =>
            sourceIds.has(r.sourceId),
          ),
        }
      : {}),
    ...(catalogBody.externalConnections
      ? {
          externalConnections: catalogBody.externalConnections.filter((r) =>
            sourceIds.has(r.datasetSourceId),
          ),
        }
      : {}),
  };
  const selectedReceipts = Object.fromEntries(
    [...sourceIds].map((id) => {
      const receipt = catalog.receipts[id];
      if (!receipt) fail("catalog_receipt_missing");
      return [id, receipt];
    }),
  );
  const recipe = {
    revisionScope: "latest" as const,
    ...(shared.identityGroups ? { identityGroups: shared.identityGroups } : {}),
    history,
    relations: {
      history,
      bindings,
      annotations: projected,
      members: [] as const,
      images,
    },
    membership: {
      history,
      source: shared.membership.source,
      approved: shared.membership.approved,
      identityPlan: identity.plan,
    },
    identity,
    schemas: shared.schemas,
    catalog: {
      ...catalog,
      receipts: selectedReceipts,
      projection: { ...selectedCatalog, sha256: nativeDigest(selectedCatalog) },
    },
  };
  for (const bytes of Object.values(recipe.membership.source))
    decodeNativePublicationBytes(bytes);
  return { planned, recipe, sha256: nativeDigest(recipe) };
}
