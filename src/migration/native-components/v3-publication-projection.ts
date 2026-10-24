import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalMigrationValue } from "../verification-values.ts";
import {
  originalMigrationOwner,
  resolveMigrationOwnership,
} from "../ownership-override.ts";
import { emailAddress } from "../../email.ts";
import { nativeDigest } from "./selection.ts";
import { assembleNativePage } from "./assemble.ts";
import type {
  NativeV3ProjectionInput,
  NativeV3PublicationHost,
  NativeV3HistoryImport,
  NativeV3AssemblyReceipt,
  NativeV3Page,
  NativeV3PublicationModules,
  NativeV3BundleDependency,
} from "./v3-publication-contracts.ts";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const validSha = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function invalid(code: string): never {
  throw Error("native_v3_" + code);
}
const exact = (a: unknown, b: unknown, code: string) => {
  if (!isDeepStrictEqual(a, b)) invalid(code);
};
/** Retained ordinary reader policy: servedRow supplies this exact version's meta.template;
 * prepareStoryParts defaults chrome to true. Capture ?chrome=0 is a request mode, not meta.chrome. */
export function nativeV3ReaderPolicy(
  original: Readonly<Record<string, unknown>>,
) {
  const meta =
    original.meta &&
    typeof original.meta === "object" &&
    !Array.isArray(original.meta)
      ? (original.meta as Record<string, unknown>)
      : {};
  return {
    sourceRecordSha256: nativeDigest(original),
    template: typeof meta.template === "string" ? meta.template : null,
    chrome: true,
  };
}
function admit(input: NativeV3ProjectionInput): NativeV3AssemblyReceipt[] {
  const { selection, planned, targets } = input;
  if (
    !validSha(selection.manifestSha256) ||
    !validSha(input.plannedSha256) ||
    !validSha(input.targetIdentitySha256) ||
    input.plannedSha256 !== sha(canonicalMigrationValue(planned)) ||
    input.targetIdentitySha256 !== nativeDigest(targets)
  )
    invalid("projection_digest");
  if (
    planned.disposition !== "ready" ||
    planned.issues.length ||
    planned.legacyId !== selection.page.sourceId ||
    planned.pageId !== input.maps.pages[planned.legacyId] ||
    !planned.revisions.length ||
    planned.original.version !== selection.page.headVersion
  )
    invalid("selection_page");
  if (planned.owner?.kind === "group" || planned.original.group_id)
    invalid("group_owner_unsupported");
  const owner = resolveMigrationOwnership(
    planned.original,
    selection.sourceNamespace,
    originalMigrationOwner(
      planned.original,
      selection.sourceNamespace,
      input.maps,
    ),
    input.ownershipOverride,
  );
  exact(owner.owner, planned.owner, "owner_changed");
  exact(
    owner.ownershipAssignment,
    planned.ownershipAssignment,
    "ownership_scope",
  );
  if (
    planned.owner?.kind !== "user" ||
    !targets.actors[planned.owner.id]?.userId
  )
    invalid("account_owner_required");
  if (
    selection.page.sourceFile.id !== selection.page.sourceId ||
    selection.page.sourceFile.expectedVersion !== selection.page.headVersion ||
    !validSha(selection.page.sourceFile.sha256)
  )
    invalid("selected_receipt");
  exact(
    planned.original,
    selection.page.revisions.find(
      (r) => r.key.version === selection.page.headVersion,
    )?.original,
    "selected_head",
  );
  for (const [sourceId, target] of Object.entries(targets.users)) {
    const actor = input.maps.users[sourceId];
    if (!actor || targets.actors[actor]?.userId !== target.userId)
      invalid("target_user_identity");
  }
  const selected = selection.page.revisions;
  const versions = selected.map((r) => r.key.version).sort((a, b) => a - b);
  if (
    new Set(versions).size !== versions.length ||
    versions.at(-1) !== selection.page.headVersion ||
    selected.length !== selection.page.sourceFile.distinctRevisions ||
    planned.revisions.length !== selected.length ||
    input.assemblies.length !== selected.length
  )
    invalid("revision_set");
  exact(
    planned.revisions.map((r) => r.version).sort((a, b) => a - b),
    versions,
    "revision_set",
  );
  const receipts: NativeV3AssemblyReceipt[] = [];
  for (const version of versions) {
    const source = selected.find((r) => r.key.version === version)!;
    if (
      source.key.sourceNamespace !== selection.sourceNamespace ||
      source.key.sourceId !== planned.legacyId ||
      source.original.version !== version ||
      source.rowSha256 !== nativeDigest(source.original) ||
      source.documentSha256 !== nativeDigest(source.original.document)
    )
      invalid("selected_source");
    const plannedRevision = planned.revisions.find(
      (r) => r.version === version,
    )!;
    if (nativeDigest(plannedRevision.original) !== source.rowSha256)
      invalid("planned_source");
    const matches = input.assemblies.filter((r) => r.key.version === version);
    if (matches.length !== 1) invalid("assembly_set");
    const receipt = matches[0]!;
    const { sha256, ...payload } = receipt;
    if (
      sha256 !== nativeDigest(payload) ||
      receipt.sourceRowSha256 !== source.rowSha256
    )
      invalid("assembly_digest");
    exact(receipt.key, source.key, "assembly_key");
    exact(receipt.input.analysis.key, source.key, "analysis_key");
    if (
      receipt.input.analysis.documentSha256 !== source.documentSha256 ||
      receipt.result.status !== "complete"
    )
      invalid("assembly_incomplete");
    const readerPolicy = nativeV3ReaderPolicy(source.original),
      reader = receipt.input.readerTemplate;
    if (reader) {
      if (
        reader.sourceRecordSha256 !== source.rowSha256 ||
        reader.template !== readerPolicy.template ||
        reader.chrome !== readerPolicy.chrome
      )
        invalid("reader_source_policy");
    } else if (
      ["doc", "editorial", "plan"].includes(readerPolicy.template ?? "")
    )
      invalid("reader_template_required");
    const result = assembleNativePage(receipt.input);
    if (
      result.status !== "complete" ||
      nativeDigest(result) !== nativeDigest(receipt.result) ||
      sha(result.html) !== receipt.result.htmlSha256
    )
      invalid("assembly_proof");
    if (
      receipt.programs.length !== receipt.input.backends.length ||
      new Set(receipt.programs.map((p) => p.namespace)).size !==
        receipt.programs.length
    )
      invalid("program_set");
    for (const program of receipt.programs) {
      const backend = receipt.input.backends.find(
        (b) => b.namespace === program.namespace,
      );
      if (
        !backend ||
        backend.planSha256 !== program.planSha256 ||
        !validSha(program.planSha256) ||
        program.programSha256 !== nativeDigest(program.program) ||
        program.provenance.compilerSha256 !==
          receipt.input.analysis.compilerSourceSha256 ||
        program.provenance.sourceSha256 !==
          receipt.input.analysis.sourceSha256 ||
        program.provenance.sqlEngineSha256 !==
          receipt.input.operationCoverage?.sqlEngineSha256
      )
        invalid("program_provenance");
      exact(program.operations, backend.operations, "operation_admission");
      if (
        program.operations.some((op) => op.kind !== program.kind) ||
        !program.operations.length
      )
        invalid("program_kind");
      exact(
        program.operations.map((op) => op.name).sort(),
        (program.kind === "query"
          ? program.program.queries.map((q) => q.name)
          : [program.program.name]
        ).sort(),
        "program_names",
      );
      if (program.kind === "mutation") {
        const descriptor = receipt.input.mutations.find(
          (d) =>
            d.namespace === program.namespace &&
            d.name === program.program.name,
        );
        if (!descriptor) invalid("mutation_descriptor");
        exact(descriptor.reset, program.program.reset, "mutation_reset");
        exact(
          [...descriptor.values]
            .map((v) => ({
              name: v.name,
              type: v.type,
              nullable: v.nullable ?? false,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          Object.entries(program.program.values)
            .map(([name, v]) => ({ name, type: v.type, nullable: v.nullable }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          "mutation_values",
        );
      } else
        for (const query of program.program.queries) {
          const descriptor = receipt.input.queries.find(
            (d) => d.namespace === program.namespace && d.name === query.name,
          );
          if (!descriptor) invalid("query_descriptor");
          exact(
            [...descriptor.values]
              .map((v) => ({ name: v.name, type: v.type }))
              .sort((a, b) => a.name.localeCompare(b.name)),
            Object.entries(program.program.scalars)
              .map(([name, v]) => ({ name, type: v.type }))
              .sort((a, b) => a.name.localeCompare(b.name)),
            "query_values",
          );
        }
      const url = new URL(backend.url);
      if (
        url.pathname !== `/api/artifacts/${planned.pageId}/graphql` ||
        url.search ||
        url.hash
      )
        invalid("backend_destination");
    }
    receipts.push(receipt);
  }
  return receipts;
}
function projectAccess(input: NativeV3ProjectionInput) {
  const roles = ["viewer", "commenter", "editor"] as const;
  if (
    !["public", "private", "unlisted"].includes(
      input.planned.access.visibility,
    ) ||
    !roles.includes(input.planned.access.linkRole as (typeof roles)[number])
  )
    invalid("access_unsupported");
  const shares = new Map<string, (typeof roles)[number]>();
  for (const row of input.planned.access.shares) {
    const role = String(row.role);
    if (!roles.includes(role as (typeof roles)[number]))
      invalid("share_role_unsupported");
    let email: string;
    if (row.user_id !== null && row.user_id !== undefined) {
      const user = input.targets.users[String(row.user_id)];
      if (!user?.email || input.maps.users[String(row.user_id)] !== user.email)
        invalid("resolved_share_identity");
      email = emailAddress(user.email);
    } else email = emailAddress(String(row.email ?? ""));
    const old = shares.get(email);
    if (
      !old ||
      roles.indexOf(role as (typeof roles)[number]) > roles.indexOf(old)
    )
      shares.set(email, role as (typeof roles)[number]);
  }
  return {
    visibility: input.planned.access
      .visibility as NativeV3HistoryImport["visibility"],
    linkRole: input.planned.access
      .linkRole as NativeV3HistoryImport["linkRole"],
    shares: [...shares]
      .map(([email, role]) => ({ email, role }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };
}
/** Pure migration projection. Existing selection, assembly and identity witnesses are admitted BEFORE any host call. */
export function projectNativeV3Publication(
  input: NativeV3ProjectionInput,
  host: NativeV3PublicationHost,
): NativeV3HistoryImport {
  const receipts = admit(input),
    access = projectAccess(input),
    ownerActor = input.planned.owner!;
  const targetOwner = input.targets.actors[ownerActor.id]!;
  const sourceToken = input.planned.original.token_id;
  const token = sourceToken ? input.targets.tokens[sourceToken] : undefined;
  if (!token?.tokenId) invalid("creator_token_missing");
  const sourceUser = (id: unknown) => {
    if (id === null || id === undefined) return null;
    const target = input.targets.users[String(id)];
    if (
      !target ||
      !input.maps.users[String(id)] ||
      input.targets.actors[input.maps.users[String(id)]!]?.userId !==
        target.userId
    )
      invalid("actor_user_missing");
    return target.userId;
  };
  const sourceTokenId = (id: unknown) => {
    if (id === null || id === undefined) return null;
    const target = input.targets.tokens[String(id)];
    if (!target || !input.maps.tokens[String(id)])
      invalid("actor_token_missing");
    return target.tokenId;
  };
  // Validate attribution/timestamps before invoking host preparation, and never fall back to current owner/time.
  for (const receipt of receipts) {
    const row = input.selection.page.revisions.find(
      (r) => r.key.version === receipt.key.version,
    )!.original;
    sourceUser(row.actor_user_id);
    sourceTokenId(row.actor_token_id);
    if (
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at))
    )
      invalid("revision_time_missing");
  }
  if (
    receipts.some(
      (r) => r.result.status === "complete" && r.result.files.length,
    ) &&
    !host.prepareBundle
  )
    invalid("bundle_adapter_required");
  const bundles: unknown[] = [];
  let ledger = { allocatedIds: [] as readonly string[], nextNodeId: 1 };
  const revisions: NativeV3HistoryImport["revisions"] = [];
  for (const receipt of receipts) {
    if (receipt.result.status !== "complete") invalid("assembly_incomplete");
    let html = receipt.result.html;
    let dependencies: readonly NativeV3BundleDependency[] | undefined;
    const sourceFiles = receipt.result.files;
    if (sourceFiles.length) {
      const bundle = host.prepareBundle!(receipt, input.planned.pageId);
      if (
        !bundle.html ||
        !validSha(bundle.assetsSha256) ||
        bundle.pageId !== input.planned.pageId ||
        bundle.sourceHtmlSha256 !== receipt.result.htmlSha256
      )
        invalid("bundle_proof");
      exact(
        bundle.fileDigests,
        [...receipt.result.files].map((f) => ({
          path: f.path,
          sha256: f.sha256,
        })),
        "bundle_files",
      );
      if (
        new Set(bundle.dependencies.map((d) => d.path)).size !==
          bundle.dependencies.length ||
        bundle.dependencies.some(
          (d) =>
            !["asset", "dataset"].includes(d.kind) ||
            !d.id ||
            !d.revision ||
            !sourceFiles.some((f) => f.path === d.path),
        )
      )
        invalid("bundle_dependencies");
      dependencies = bundle.dependencies;
      html = bundle.html;
      bundles.push({
        version: receipt.key.version,
        htmlSha256: sha(html),
        assetsSha256: bundle.assetsSha256,
        dependencies,
        files: bundle.fileDigests,
      });
    }
    const canonical = host.canonicalize(html, {
      previousHtml: html,
      ledger: {
        allocatedIds: [
          ...new Set([
            ...ledger.allocatedIds,
            ...receipt.input.identity.reservedIdentities.map((i) => i.afId),
          ]),
        ],
        nextNodeId: ledger.nextNodeId,
      },
    });
    if (
      !canonical.html ||
      !Number.isSafeInteger(canonical.ledger.nextNodeId) ||
      canonical.ledger.nextNodeId < ledger.nextNodeId ||
      canonical.nodeIds.some(
        (id) => !canonical.ledger.allocatedIds.includes(id),
      ) ||
      ledger.allocatedIds.some(
        (id) => !canonical.ledger.allocatedIds.includes(id),
      ) ||
      receipt.input.identity.reservedIdentities.some(
        (i) => !canonical.ledger.allocatedIds.includes(i.afId),
      )
    )
      invalid("canonical_identity");
    ledger = canonical.ledger;
    const page: NativeV3Page = {
      pageId: input.planned.pageId,
      version: receipt.key.version,
      revision: String(receipt.key.version),
      html: canonical.html,
      nextNodeId: ledger.nextNodeId,
      links: [],
    };
    const queries = receipt.programs
      .filter((p) => p.kind === "query")
      .map((p) => host.prepareQuery(page, p));
    const mutations = receipt.programs
      .filter((p) => p.kind === "mutation")
      .map((p) => host.prepareMutation(page, p));
    page.links = [...queries, ...mutations].map((p) => p.link);
    for (const prepared of [...queries, ...mutations]) {
      const expected = receipt.programs.find(
        (p) => p.namespace === prepared.link.name,
      );
      if (
        !expected ||
        prepared.link.backendId !== expected.backendId ||
        prepared.backend.name !== expected.namespace
      )
        invalid("prepared_backend");
      host.verifyProgram(page, prepared, expected.kind, targetOwner.userId);
    }
    const row = input.selection.page.revisions.find(
      (r) => r.key.version === receipt.key.version,
    )!.original;
    revisions.push({
      ...(dependencies ? { htmlPublicationDependencies: dependencies } : {}),
      page,
      ledger,
      sourceSha256: sha(page.html),
      title: typeof row.title === "string" ? row.title : null,
      description: typeof row.description === "string" ? row.description : null,
      createdAt: String(row.created_at),
      actorUserId: sourceUser(row.actor_user_id),
      actorTokenId: sourceTokenId(row.actor_token_id),
      queries,
      mutations,
    });
  }
  const output: NativeV3HistoryImport = {
    sourceNamespace: input.selection.sourceNamespace,
    sourceId: input.planned.legacyId,
    selectionSha256: input.selection.manifestSha256,
    projectionSha256: "",
    pageId: input.planned.pageId,
    owner: { userId: targetOwner.userId, tokenId: token.tokenId },
    ...access,
    headVersion: input.selection.page.headVersion,
    revisions,
  };
  // Keep relation digest separate: B/C calculate it from this immutable base projection without a hash cycle.
  output.projectionSha256 = nativeDigest({
    selection: input.selection,
    plannedSha256: input.plannedSha256,
    maps: input.maps,
    targetIdentitySha256: input.targetIdentitySha256,
    assemblies: receipts.map((r) => r.sha256),
    bundles,
    history: output,
  });
  if (input.relationSha256 !== undefined) {
    if (!validSha(input.relationSha256)) invalid("relation_digest");
    output.relationSha256 = input.relationSha256;
  }
  return output;
}
/** Canonical final source bindings for B. Actual host IDs determine presence; retired ledger IDs never become anchors. */
export function projectNativeV3RelationBindings(
  input: NativeV3ProjectionInput,
  history: NativeV3HistoryImport,
  host: NativeV3PublicationHost,
) {
  const expected = projectNativeV3Publication(input, host);
  const { relationSha256: _expectedRelation, ...expectedBase } = expected,
    { relationSha256: _actualRelation, ...actualBase } = history;
  exact(actualBase, expectedBase, "relation_projection");
  const receipts = admit(input);
  if (
    history.sourceNamespace !== input.selection.sourceNamespace ||
    history.sourceId !== input.planned.legacyId ||
    history.pageId !== input.planned.pageId ||
    history.revisions.length !== receipts.length
  )
    invalid("relation_history");
  return receipts.flatMap((receipt) => {
    const revision = history.revisions.find(
      (r) => r.page.version === receipt.key.version,
    );
    if (!revision || revision.sourceSha256 !== sha(revision.page.html))
      invalid("relation_source");
    const canonical = host.canonicalize(revision.page.html, {
      previousHtml: revision.page.html,
      ledger: revision.ledger,
    });
    if (canonical.html !== revision.page.html) invalid("relation_canonical");
    return receipt.input.identity.bindings
      .filter((binding) => canonical.nodeIds.includes(binding.afId))
      .map((binding) => ({
        version: receipt.key.version,
        htmlSha256: revision.sourceSha256,
        sourceNamespace: receipt.key.sourceNamespace,
        sourceNodeId: binding.sourceNode,
        nodeId: binding.afId,
      }));
  });
}

/** Direct adapter over the existing v3 exports. Modules are loaded by an offline host, never by generated page code. */
export function createNativeV3PublicationHost(
  modules: NativeV3PublicationModules,
): NativeV3PublicationHost {
  return {
    ...(modules.prepareBundle ? { prepareBundle: modules.prepareBundle } : {}),
    canonicalize: (html, options) =>
      modules.canonicalizeHtmlPage(html, options),
    prepareQuery: (page, receipt) =>
      modules.prepareRegisteredQueryBackend(
        receipt.namespace,
        receipt.backendId,
        page,
        receipt.program,
        receipt.provenance,
      ),
    prepareMutation: (page, receipt) =>
      modules.prepareRegisteredMutationBackend(
        receipt.namespace,
        receipt.backendId,
        page,
        receipt.program,
        receipt.provenance,
      ),
    verifyProgram(page, prepared, kind, ownerId) {
      const record = {
        ...prepared.backend,
        backendId: prepared.link.backendId,
        version: prepared.link.version,
        pageId: page.pageId,
        ownerId,
        secretBindings: [],
      };
      const plan = (
        kind === "query"
          ? modules.registeredPlan
          : modules.registeredMutationPlan
      )(page, prepared.link, record);
      if (
        !plan ||
        typeof plan !== "object" ||
        !("registration" in plan) ||
        !plan.registration ||
        typeof plan.registration !== "object"
      )
        invalid("host_registration");
      exact(
        plan.registration,
        {
          pageId: page.pageId,
          pageVersion: page.version,
          sourceSha256: sha(page.html),
          backendId: prepared.link.backendId,
          backendVersion: prepared.link.version,
        },
        "host_source_fence",
      );
    },
  };
}
