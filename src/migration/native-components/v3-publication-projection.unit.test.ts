import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { nativeDigest } from "./selection.ts";
import { nativeReceiptDigest } from "./receipt-digest.ts";
import { canonicalMigrationValue } from "../verification-values.ts";
import { bindNativeIdentities } from "./identity.ts";
import { prepareNativeReaderTemplate } from "./reader-template.ts";
import { assembleNativePage } from "./assemble.ts";
import { NATIVE_COMPONENT_TARGET } from "./component-map.ts";
import {
  createNativeV3PublicationHost,
  projectNativeV3RelationBindings,
  projectNativeV3Publication,
  preflightNativeV3Publication,
} from "./v3-publication-projection.ts";
import type {
  NativeV3ProjectionInput,
  NativeV3PublicationHost,
  NativeV3PreparedBackend,
  NativeV3ProgramReceipt,
} from "./v3-publication-contracts.ts";
import type { NativeGraphAnalysis } from "./contracts.ts";
import type { NativeTypedAnalysis } from "./analyze-contracts.ts";
import type { NativeAssemblyInput } from "./assemble-contracts.ts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture(withPeople = false) {
  const sourceNamespace = "synthetic",
    sourceId = "SourcePage",
    pageId = "TargetPage";
  const originals = [1, 3].map((version) => ({
    id: sourceId,
    version,
    format: "markup",
    user_id: "old-user",
    token_id: "old-token",
    group_id: null,
    source: "Retained",
    document: { kind: "graph", version },
    title: `Version ${version}`,
    description: null,
    created_at: `2020-01-0${version}T00:00:00.000Z`,
    actor_user_id: "old-user",
    actor_token_id: "old-token",
    visibility: "private",
    link_role: "viewer",
  }));
  const graphs: NativeGraphAnalysis[] = originals.map((row) => ({
    key: { sourceNamespace, sourceId, version: row.version },
    documentSha256: nativeDigest(row.document),
    sourceSha256: sha("Retained"),
    source: "Retained",
    identities: [
      {
        sourceNode: "$root",
        parent: null,
        children: ["text"],
        sourceStart: 0,
        sourceEnd: 8,
        astSha256: "a".repeat(64),
        nodeSha256: "b".repeat(64),
      },
      {
        sourceNode: "text",
        parent: "$root",
        children: [],
        sourceStart: 0,
        sourceEnd: 8,
        astSha256: "c".repeat(64),
        nodeSha256: "d".repeat(64),
      },
    ],
    claimedIds: {},
    components: {},
    recovery: { kind: "exact", repairedNodes: 0 },
  }));
  const analyses: NativeTypedAnalysis[] = graphs.map((graph) => ({
    key: graph.key,
    documentSha256: graph.documentSha256,
    sourceSha256: graph.sourceSha256,
    analysisSha256: nativeDigest(graph),
    compilerSourceSha256: "f".repeat(64),
    nodes: [
      { type: "text", graphKey: "text", start: 0, end: 8, value: "Retained" },
    ],
    flow: {
      imports: withPeople ? [{name:"people",ref:"Dataset",start:0,end:8}] : [],
      values: [],
      queries: [{ name: "rows", start: 0, end: 8 }],
      mutations: [],
    },
    sourceSpans: graph.identities.map((n) => ({
      sourceNode: n.sourceNode,
      sourceStart: n.sourceStart,
      sourceEnd: n.sourceEnd,
    })),
  }));
  const identities = bindNativeIdentities(
    graphs.map((graph, i) => ({ graph, typed: analyses[i]! })),
  );
  const program: Extract<NativeV3ProgramReceipt, { kind: "query" }>["program"] =
    {
      scalars: {},
      queries: [{ name: "rows", sql: "SELECT 1 AS value", dependencies: [] }],
      imports: [],
    };
  const operations = [
    { kind: "query" as const, name: "rows", operationSha256: "1".repeat(64) },
  ];
  const assemblies = analyses.map((analysis, i) => {
    const query = {
      name: "rows",
      namespace: "records",
      document:
        "query Rows($only:[records__QueryName!]!){records{evaluate(only:$only){tables{name error}}}}",
      values: [],
      tableName: "rows",
      responsePath: ["records", "evaluate", "tables"],
      decode: "registered-page-table-cells-v1" as const,
    };
    const input: NativeAssemblyInput = {
      analysis,
      ...(withPeople ? {people:{namespace:"people",datasetRef:"ref:Dataset",mode:"live" as const,authority:"linked-dataset-typed-user-v1" as const}} : {}),
      identity: identities[i]!,
      targetRevision: NATIVE_COMPONENT_TARGET,
      coreUrl: "/af/v1/core.js",
      backends: [
        {
          namespace: "records",
          url: `https://example.test/api/artifacts/${pageId}/graphql`,
          descriptorsSha256: nativeDigest({ queries: [query], mutations: [] }),
          planSha256: "2".repeat(64),
          operations,
        },
      ],
      queries: [query],
      mutations: [],
      operationCoverage: {
        sourceSha256: analysis.sourceSha256,
        compilerSourceSha256: analysis.compilerSourceSha256,
        sqlEngineSha256: "3".repeat(64),
        queryOrder: ["rows"],
        blockers: [],
        operations: [
          {
            ...operations[0]!,
            sourceNode: "$flow",
            route: "registered-sqlite-query",
            dependencies: [],
            requiredGuarantees: [],
            status: "attested-plan",
          },
        ],
      },
    };
    const result = assembleNativePage(input);
    assert.equal(result.status, "complete", JSON.stringify(result.blockers));
    const receipt = {
      key: analysis.key,
      sourceRowSha256: nativeDigest(originals[i]),
      input,
      result,
      programs: [
        {
          kind: "query" as const,
          namespace: "records",
          backendId: "registered_records",
          program,
          programSha256: nativeDigest(program),
          planSha256: "2".repeat(64),
          provenance: {
            compilerSha256: analysis.compilerSourceSha256,
            sourceSha256: analysis.sourceSha256,
            sqlEngineSha256: "3".repeat(64),
          },
          operations,
        },
      ],
    };
    return { ...receipt, sha256: nativeReceiptDigest(receipt) };
  });
  const planned: NativeV3ProjectionInput["planned"] = {
    legacyId: sourceId,
    pageId,
    owner: { kind: "user", id: "owner@example.test" },
    disposition: "ready",
    issues: [],
    revisions: originals.map((original) => ({
      version: original.version,
      original,
      conversion: {
        classification: "functional",
        html: "Retained conversion provenance",
        identities: {},
        issues: [],
      },
    })),
    access: {
      visibility: "private",
      linkRole: "viewer",
      shares: [
        { email: "invite@example.test", role: "commenter" },
        { user_id: "old-user", email: "obsolete@example.test", role: "viewer" },
      ],
    },
    original: originals[1]!,
    comments: [],
    identities: [],
  };
  const targets = {
    actors: { "owner@example.test": { userId: "usr_target" } },
    users: {
      "old-user": { userId: "usr_target", email: "owner@example.test" },
    },
    tokens: { "old-token": { tokenId: "tok_provenance" } },
  };
  const input: NativeV3ProjectionInput = {
    selection: {
      sourceNamespace,
      manifestSha256: "4".repeat(64),
      page: {
        sourceId,
        headVersion: 3,
        sourceFile: {
          id: sourceId,
          path: "page.json",
          sha256: "5".repeat(64),
          bytes: 100,
          expectedVersion: 3,
          distinctRevisions: 2,
          archivedRows: 1,
        },
        revisions: originals.map((original) => ({
          key: { sourceNamespace, sourceId, version: original.version },
          rowSha256: nativeDigest(original),
          documentSha256: nativeDigest(original.document),
          original,
          matchingArchives: [],
        })),
      },
    },
    planned,
    plannedSha256: sha(canonicalMigrationValue(planned)),
    maps: {
      pages: { [sourceId]: pageId, ...(withPeople ? {Dataset:"Dataset"} : {}) },
      users: { "old-user": "owner@example.test" },
      tokens: { "old-token": "owner@example.test" },
      groups: {},
    },
    targets,
    targetIdentitySha256: nativeDigest(targets),
    assemblies,
  };
  const events: string[] = [];
  const host: NativeV3PublicationHost = {
    canonicalize(html, options) {
      events.push("canonicalize");
      return {
        html: html.endsWith("<!-- canonical host -->")
          ? html
          : html + "<!-- canonical host -->",
        ledger: {
          allocatedIds: options.ledger.allocatedIds,
          nextNodeId: options.ledger.nextNodeId,
        },
        nodeIds: options.ledger.allocatedIds.filter((id) =>
          html.includes(`data-af-id="${id}"`),
        ),
      };
    },
    prepareQuery(page, receipt) {
      events.push("prepare");
      assert.match(page.html, /canonical host/);
      return {
        link: {
          kind: "backend",
          name: receipt.namespace,
          backendId: receipt.backendId,
          version: sha(page.html),
        },
        backend: {
          name: receipt.namespace,
          source: page.html,
          compiled: "synthetic-host-envelope",
          typeDefs: "type Query {value:Int}",
        },
        envelope: { sourceSha256: sha(page.html) },
      };
    },
    prepareMutation() {
      throw Error("not used");
    },
    verifyProgram(page, prepared) {
      events.push("verify");
      assert.equal(prepared.backend.source, page.html);
    },
  };
  return { input, host, events };
}
test("projects exact sparse selected source through canonical host before registration without treating v2 actors as v3 IDs", () => {
  const { input, host, events } = fixture(),
    output = projectNativeV3Publication(input, host);
  assert.deepEqual(output.owner, {
    userId: "usr_target",
    tokenId: "tok_provenance",
  });
  assert.deepEqual(
    output.revisions.map((r) => r.page.version),
    [1, 3],
  );
  assert.equal(output.headVersion, 3);
  assert.equal(output.selectionSha256, input.selection.manifestSha256);
  assert.deepEqual(output.shares, [
    { email: "invite@example.test", role: "commenter" },
    { email: "owner@example.test", role: "viewer" },
  ]);
  assert.equal(output.revisions[0]!.createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(output.revisions[1]!.actorUserId, "usr_target");
  assert.equal(
    output.revisions[1]!.sourceSha256,
    sha(output.revisions[1]!.page.html),
  );
  assert.deepEqual(events, [
    "canonicalize",
    "prepare",
    "verify",
    "canonicalize",
    "prepare",
    "verify",
  ]);
  assert.equal(output.projectionSha256.length, 64);
  assert.equal(
    projectNativeV3Publication(input, host).projectionSha256,
    output.projectionSha256,
  );
});
test("rejects missing/extra histories, changed original rows and unbound assemblies before host preparation", () => {
  for (const change of [
    (i: NativeV3ProjectionInput) => {
      i.assemblies = i.assemblies.slice(1);
    },
    (i: NativeV3ProjectionInput) => {
      i.selection.page.revisions[0]!.original.title = "changed";
    },
    (i: NativeV3ProjectionInput) => {
      i.assemblies[0]!.result = {
        status: "blocked",
        html: null,
        bindingTargets: [],
        blockers: [{ sourceNode: "x", code: "blocked" }],
      };
    },
    (i: NativeV3ProjectionInput) => {
      i.assemblies[0]!.input.identity.bindings[0]!.afId = "forged";
    },
  ]) {
    const { input, host, events } = fixture();
    change(input);
    assert.throws(() => projectNativeV3Publication(input, host));
    assert.equal(events.length, 0);
  }
});
test("binds exact assembled file bytes in the native assembly receipt", () => {
  const { input, host, events } = fixture();
  const receipt = input.assemblies[0]!;
  const bytes = Buffer.from([0, 1, 127, 128, 255]);
  receipt.input.files = [
    {
      path: "components/receipt-proof.js",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  receipt.result = assembleNativePage(receipt.input);
  assert.equal(receipt.result.status, "complete");
  const { sha256, ...payload } = receipt;
  receipt.sha256 = nativeReceiptDigest(payload);
  host.prepareBundle = (assembly, pageId) => {
    if (assembly.result.status !== "complete") throw Error("assembly blocked");
    return {
      pageId,
      sourceHtmlSha256: assembly.result.htmlSha256,
      html: assembly.result.html,
      assetsSha256: "8".repeat(64),
      dependencies: [],
      fileDigests: assembly.result.files.map(({ path, sha256 }) => ({
        path,
        sha256,
      })),
    };
  };
  projectNativeV3Publication(input, host);
  const prepared = events.length;
  bytes[2] = bytes[2]! ^ 1;
  assert.throws(
    () => projectNativeV3Publication(input, host),
    /native_v3_assembly_digest/,
  );
  assert.equal(events.length, prepared);
});
test("rejects group ownership, missing target identities, mismatched actor maps and unsupported ACLs explicitly", () => {
  for (const change of [
    (i: NativeV3ProjectionInput) => {
      i.planned.owner = { kind: "group", id: "group" };
    },
    (i: NativeV3ProjectionInput) => {
      i.targets.tokens = {};
    },
    (i: NativeV3ProjectionInput) => {
      i.planned.access.linkRole = "admin";
    },
  ]) {
    const { input, host } = fixture();
    change(input);
    input.plannedSha256 = sha(canonicalMigrationValue(input.planned));
    input.targetIdentitySha256 = nativeDigest(input.targets);
    assert.throws(() => projectNativeV3Publication(input, host), /native_v3_/);
  }
});
test("rejects changed program content and provenance rather than registering another SQL plan", () => {
  const { input, host, events } = fixture();
  input.assemblies[0]!.programs[0]!.programSha256 = "0".repeat(64);
  const { sha256, ...payload } = input.assemblies[0]!;
  input.assemblies[0]!.sha256 = nativeReceiptDigest(payload);
  assert.throws(() => projectNativeV3Publication(input, host));
  assert.equal(events.length, 0);
});

test("relation witnesses bind final canonical HTML and reject a changed persisted source", () => {
  const { input, host } = fixture();
  const history = projectNativeV3Publication(input, host);
  const bindings = projectNativeV3RelationBindings(input, history, host);
  assert.equal(bindings.length, 2);
  for (const binding of bindings) {
    assert.equal(binding.sourceNodeId, "text");
    assert.equal(
      binding.htmlSha256,
      history.revisions.find((r) => r.page.version === binding.version)!
        .sourceSha256,
    );
  }
  history.revisions[0]!.page.html += "changed";
  history.revisions[0]!.sourceSha256 = sha(history.revisions[0]!.page.html);
  assert.throws(
    () => projectNativeV3RelationBindings(input, history, host),
    /relation_projection/,
  );
});
test("direct host module adapter passes exact program/provenance and requires actual registration source fence", () => {
  const { input, host } = fixture();
  let stale = false;
  const direct = createNativeV3PublicationHost({
    canonicalizeHtmlPage: host.canonicalize,
    prepareRegisteredQueryBackend(name, id, page, program, provenance) {
      assert.equal(name, "records");
      assert.equal(id, "registered_records");
      assert.equal(program.queries[0]!.sql, "SELECT 1 AS value");
      assert.equal(provenance.compilerSha256, "f".repeat(64));
      return host.prepareQuery(
        page,
        input.assemblies[0]!.programs[0]! as Extract<
          NativeV3ProgramReceipt,
          { kind: "query" }
        >,
      );
    },
    prepareRegisteredMutationBackend() {
      throw Error("not used");
    },
    registeredPlan(page, link, record) {
      assert.equal(record.ownerId, "usr_target");
      return {
        registration: {
          pageId: page.pageId,
          pageVersion: page.version,
          sourceSha256: stale ? "0".repeat(64) : sha(page.html),
          backendId: link.backendId,
          backendVersion: link.version,
        },
      };
    },
    registeredMutationPlan() {
      throw Error("not used");
    },
  });
  assert.equal(projectNativeV3Publication(input, direct).revisions.length, 2);
  stale = true;
  assert.throws(
    () => projectNativeV3Publication(input, direct),
    /host_source_fence/,
  );
});

test("requires staged real bundle rewrite receipt before canonicalization for nonempty module/resources", () => {
  const { input, host, events } = fixture();
  const receipt = input.assemblies[0]!;
  receipt.input.files = [
    {
      path: "assets/example.css",
      bytes: new TextEncoder().encode("p{}"),
      sha256: sha("p{}"),
    },
  ];
  receipt.result = assembleNativePage(receipt.input);
  assert.equal(receipt.result.status, "complete");
  const { sha256, ...payload } = receipt;
  receipt.sha256 = nativeReceiptDigest(payload);
  assert.throws(
    () => projectNativeV3Publication(input, host),
    /bundle_adapter_required/,
  );
  assert.equal(events.length, 0);
  host.prepareBundle = (assembly, pageId) => {
    events.push("bundle");
    if (assembly.result.status !== "complete") throw Error();
    return {
      pageId,
      sourceHtmlSha256: assembly.result.htmlSha256,
      html: assembly.result.html + "<!-- staged resource URLs -->",
      assetsSha256: "9".repeat(64),
      dependencies: [],
      fileDigests: assembly.result.files.map((f) => ({
        path: f.path,
        sha256: f.sha256,
      })),
    };
  };
  const output = projectNativeV3Publication(input, host);
  assert.match(output.revisions[0]!.page.html, /staged resource URLs/);
  assert.deepEqual(events.slice(0, 4), [
    "bundle",
    "canonicalize",
    "prepare",
    "verify",
  ]);
  host.prepareBundle = () => ({
    pageId: "WrongPage",
    sourceHtmlSha256: "0".repeat(64),
    html: "changed",
    assetsSha256: "9".repeat(64),
    dependencies: [],
    fileDigests: [],
  });
  assert.throws(() => projectNativeV3Publication(input, host), /bundle_proof/);
});

test("preserves separately admitted mutation target, typed values and commit-only resets in server preparation", () => {
  const { input, host } = fixture();
  for (const receipt of input.assemblies) {
    const descriptor = {
      name: "save",
      namespace: "actions",
      document:
        "mutation Save($requestId:String!,$values:actions__Values!){actions{run(requestId:$requestId,values:$values){outcome reset}}}",
      values: [{ name: "body", type: "string", nullable: false }],
      outcomePath: ["actions", "run"],
      reset: ["body"],
    };
    receipt.input.analysis.flow.values.push({
      name: "body",
      type: "string",
      default: "",
      start: 0,
      end: 8,
    });
    receipt.input.analysis.flow.mutations.push({
      name: "save",
      start: 0,
      end: 8,
    });
    receipt.input.mutations = [descriptor];
    const operations = [
      {
        kind: "mutation" as const,
        name: "save",
        operationSha256: "8".repeat(64),
      },
    ];
    receipt.input.backends = [
      ...receipt.input.backends,
      {
        namespace: "actions",
        url: "https://example.test/api/artifacts/TargetPage/graphql",
        descriptorsSha256: nativeDigest({
          queries: [],
          mutations: [descriptor],
        }),
        planSha256: "7".repeat(64),
        operations,
      },
    ];
    receipt.input.operationCoverage!.operations = [
      ...receipt.input.operationCoverage!.operations,
      {
        ...operations[0]!,
        sourceNode: "$flow",
        route: "registered-dataset-mutation",
        dependencies: [],
        requiredGuarantees: ["expected-affected", "commit-only-reset"],
        status: "attested-plan",
      },
    ];
    const program: Extract<
      NativeV3ProgramReceipt,
      { kind: "mutation" }
    >["program"] = {
      name: "save",
      kind: "insert",
      sql: "INSERT INTO form.rows(body) VALUES ($body)",
      target: { datasetId: "MappedDataset", schema: "form", table: "rows" },
      values: { body: { type: "string", nullable: false, parameter: "body" } },
      builtins: [],
      expectedAffected: 1,
      reset: ["body"],
    };
    receipt.programs = [
      ...receipt.programs,
      {
        kind: "mutation",
        namespace: "actions",
        backendId: "registered_actions",
        planSha256: "7".repeat(64),
        programSha256: nativeDigest(program),
        program,
        operations,
        provenance: {
          compilerSha256: receipt.input.analysis.compilerSourceSha256,
          sourceSha256: receipt.input.analysis.sourceSha256,
          sqlEngineSha256: receipt.input.operationCoverage!.sqlEngineSha256,
        },
      },
    ];
    receipt.result = assembleNativePage(receipt.input);
    assert.equal(
      receipt.result.status,
      "complete",
      JSON.stringify(receipt.result.blockers),
    );
    const { sha256, ...payload } = receipt;
    receipt.sha256 = nativeReceiptDigest(payload);
  }
  let calls = 0;
  host.prepareMutation = (page, receipt) => {
    calls++;
    assert.deepEqual(receipt.program.target, {
      datasetId: "MappedDataset",
      schema: "form",
      table: "rows",
    });
    assert.deepEqual(receipt.program.reset, ["body"]);
    assert.equal(receipt.program.expectedAffected, 1);
    return {
      link: {
        kind: "backend",
        name: receipt.namespace,
        backendId: receipt.backendId,
        version: sha(page.html + "actions"),
      },
      backend: {
        name: receipt.namespace,
        source: page.html,
        compiled: "synthetic-host-mutation",
        typeDefs: "type Mutation {run:Int}",
      },
      envelope: {},
    };
  };
  const output = projectNativeV3Publication(input, host);
  assert.equal(calls, 2);
  assert.equal(output.revisions[0]!.mutations[0]!.link.name, "actions");
  assert.equal(output.revisions[1]!.page.links.length, 2);
});

function readerFixture(template: string | null = "doc") {
  const fixtureInput = fixture(),
    { input } = fixtureInput;
  const row = input.selection.page.revisions[0]!.original;
  row.meta = { template, chrome: false };
  const selected = input.selection.page.revisions[0]!;
  selected.rowSha256 = nativeDigest(row);
  const receipt = input.assemblies[0]!;
  receipt.sourceRowSha256 = selected.rowSha256;
  receipt.input.readerTemplate = prepareNativeReaderTemplate({
    analysis: receipt.input.analysis,
    identity: receipt.input.identity,
    sourceRecordSha256: selected.rowSha256,
    template,
    chrome: true,
  });
  receipt.result = assembleNativePage(receipt.input);
  assert.equal(receipt.result.status, "complete");
  const { sha256, ...payload } = receipt;
  receipt.sha256 = nativeReceiptDigest(payload);
  input.plannedSha256 = sha(canonicalMigrationValue(input.planned));
  return fixtureInput;
}
test("reader template binds exact saved revision metadata and ordinary reader chrome rather than meta.chrome", () => {
  const { input, host } = readerFixture();
  const history = projectNativeV3Publication(input, host);
  assert.match(history.revisions[0]!.page.html, /mx-doc--document/);
  assert.doesNotMatch(history.revisions[1]!.page.html, /mx-doc--document/);
  const other = readerFixture("landing");
  assert.equal(
    projectNativeV3Publication(other.input, other.host).revisions.length,
    2,
  );
});
test("rejects correctly rehashed reader receipts for another source row, template or capture policy", () => {
  for (const change of [
    (r: NonNullable<NativeAssemblyInput["readerTemplate"]>) => {
      r.sourceRecordSha256 = "0".repeat(64);
    },
    (r: NonNullable<NativeAssemblyInput["readerTemplate"]>) => {
      r.template = "editorial";
    },
    (r: NonNullable<NativeAssemblyInput["readerTemplate"]>) => {
      r.chrome = false;
    },
  ]) {
    const { input, host, events } = readerFixture();
    const receipt = input.assemblies[0]!,
      reader = receipt.input.readerTemplate!;
    change(reader);
    receipt.input.readerTemplate = prepareNativeReaderTemplate({
      analysis: receipt.input.analysis,
      identity: receipt.input.identity,
      sourceRecordSha256: reader.sourceRecordSha256,
      template: reader.template,
      chrome: reader.chrome,
    });
    receipt.result = assembleNativePage(receipt.input);
    assert.equal(receipt.result.status, "complete");
    const { sha256, ...payload } = receipt;
    receipt.sha256 = nativeReceiptDigest(payload);
    assert.throws(
      () => projectNativeV3Publication(input, host),
      /native_v3_reader_source_policy/,
    );
    assert.equal(events.length, 0);
  }
});
test("requires retained normal-reader recipe for doc/editorial/plan instead of silently omitting navigation", () => {
  for (const template of ["doc", "editorial", "plan"]) {
    const { input, host } = readerFixture(template),
      receipt = input.assemblies[0]!;
    delete receipt.input.readerTemplate;
    receipt.result = assembleNativePage(receipt.input);
    const { sha256, ...payload } = receipt;
    receipt.sha256 = nativeReceiptDigest(payload);
    assert.throws(
      () => projectNativeV3Publication(input, host),
      /native_v3_reader_template_required/,
    );
  }
});

function latestFixture() {
  const f=fixture();
  f.input.revisionScope="latest";
  f.input.planned.revisions=f.input.planned.revisions.filter(r=>r.version===f.input.selection.page.headVersion);
  f.input.assemblies=f.input.assemblies.filter(r=>r.key.version===f.input.selection.page.headVersion);
  f.input.plannedSha256=sha(canonicalMigrationValue(f.input.planned));
  return f;
}
test("explicit latest scope imports only the real head while preserving the complete canonical source receipt",()=>{
  const {input,host}=latestFixture(),source=structuredClone(input.selection);
  const projected=projectNativeV3Publication(input,host);
  assert.deepEqual(projected.revisions.map(r=>r.page.version),[3]);
  assert.equal(input.selection.page.sourceFile.distinctRevisions,2);
  assert.deepEqual(input.selection,source);
  const original=fixture();
  assert.deepEqual(projectNativeV3Publication(original.input,original.host).revisions.map(r=>r.page.version),[1,3]);
});
test("latest scope rejects historical expansion, a nonhead substitute and fabricated canonical revision counts before host calls",()=>{
  for(const change of [
    (f:ReturnType<typeof latestFixture>)=>{f.input.assemblies=fixture().input.assemblies;},
    (f:ReturnType<typeof latestFixture>)=>{f.input.planned.revisions=fixture().input.planned.revisions.filter(r=>r.version===1);f.input.plannedSha256=sha(canonicalMigrationValue(f.input.planned));},
    (f:ReturnType<typeof latestFixture>)=>{f.input.selection.page.sourceFile.distinctRevisions=1;},
  ]){const f=latestFixture();change(f);assert.throws(()=>projectNativeV3Publication(f.input,f.host),/native_v3_revision_set/);assert.equal(f.events.length,0);}
});
test("preflight admits exact assemblies and resolved access without invoking any target host",()=>{
 const f=latestFixture(),before=structuredClone(f.input);
 const admitted=preflightNativeV3Publication(f.input);
 assert.equal(admitted.revisionScope,"latest");assert.deepEqual(admitted.assemblies,f.input.assemblies);
 assert.equal(admitted.access.visibility,"private");assert.equal(admitted.access.linkRole,"viewer");
 assert.equal(f.events.length,0);assert.deepEqual(f.input,before);
 f.input.planned.access.shares[0]!.role="owner";f.input.plannedSha256=sha(canonicalMigrationValue(f.input.planned));
 assert.throws(()=>preflightNativeV3Publication(f.input),/native_v3_share_role_unsupported/);
});

test("preflight defaults to complete history and rejects unknown scope before target work",()=>{
 const f=fixture();assert.equal(preflightNativeV3Publication(f.input).revisionScope,"history");
 assert.equal(preflightNativeV3Publication(f.input).assemblies.length,2);
 (f.input as unknown as {revisionScope:string}).revisionScope="other";
 assert.throws(()=>preflightNativeV3Publication(f.input),/native_v3_revision_scope/);
 assert.equal(f.events.length,0);
});

test("catalog source survives publication host preparation and is fenced by program provenance", () => {
  const {input,host}=fixture();
  for(const receipt of input.assemblies){
    const program=receipt.programs[0]!;
    if(program.kind!=="query")throw Error("query fixture");
    program.program.queries[0]!.source="MappedCatalog";
    program.programSha256=nativeDigest(program.program);
    const {sha256,...payload}=receipt;receipt.sha256=nativeReceiptDigest(payload);
  }
  let prepared=0;
  projectNativeV3Publication(input,{...host,prepareQuery(page,receipt){
    assert.equal(receipt.program.queries[0]!.source,"MappedCatalog");
    assert.equal(receipt.program.queries[0]!.sql,"SELECT 1 AS value");
    assert.deepEqual(receipt.program.queries[0]!.dependencies,[]);
    prepared++;return host.prepareQuery(page,receipt);
  }});
  assert.equal(prepared,2);
  const receipt=input.assemblies[0]!,program=receipt.programs[0]!;
  if(program.kind!=="query")throw Error("query fixture");
  program.program.queries[0]!.source="ChangedCatalog";
  const {sha256,...payload}=receipt;receipt.sha256=nativeReceiptDigest(payload);
  assert.throws(()=>projectNativeV3Publication(input,host),/program_provenance/);
});

test("preserves the exact source-bound live people dataset link beside SQL links in saved reader versions",()=>{
 const {input,host}=fixture(true);const result=projectNativeV3Publication(input,host);for(const revision of result.revisions){assert.ok(revision.page.html.includes('rel="af-dataset"'));assert.deepEqual(revision.page.links.filter(link=>link.kind==='dataset'),[{kind:'dataset',name:'people',datasetId:'Dataset',mode:'live'}]);assert.equal(revision.page.links.filter(link=>link.kind==='backend').length,1);}
});
test("refuses an unadmitted or rewritten people dataset identity rather than inventing a destination link",()=>{
 for(const mapping of [undefined,'OtherDataset']){const {input,host}=fixture(true);if(mapping===undefined)delete input.maps.pages.Dataset;else input.maps.pages.Dataset=mapping;assert.throws(()=>projectNativeV3Publication(input,host),/dataset_identity/);}
});
test("rejects a people namespace collision with SQL registration before any host write",()=>{
 const {input,host,events}=fixture(true);for(const receipt of input.assemblies){receipt.input.people!.namespace='records';receipt.input.analysis.flow.imports[0]!.name='records';const {sha256:_,...body}=receipt;receipt.sha256=nativeReceiptDigest(body);}assert.throws(()=>projectNativeV3Publication(input,host),/dataset_namespace_collision/);assert.deepEqual(events,[]);
});
