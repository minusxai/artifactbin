import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareMigrationJobDatasets } from "../src/migration/job-datasets.ts";
import { readBackendModule } from "../src/backend/af-module.ts";
import { boundedBackendSchema } from "../src/graphql/execution-policy.ts";
import { sealDeployment } from "../src/backend/deployment.ts";
import { generatedDatasetBackendSource } from "../src/migration/datasets/import-metadata.ts";
import type {
  MigrationJobOptions,
  MigrationJobSource,
} from "../src/migration/job-contracts.ts";
import type {
  MigrationManifest,
  LegacyArtifact,
} from "../src/migration/contracts.ts";
test("job prepares exact live head bindings and real compiled receipts without inventing historical execution", async () => {
  const sha = createHash("sha256").update("[]").digest("hex");
  const base: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    tables: { users: [{ id: "owner", kind: "user" }] },
    artifacts: [],
    tokenOwners: [
      { id: "token", user_id: "owner" },
      { id: "unrelated", user_id: "missing" },
    ],
  };
  const page: LegacyArtifact = {
    id: "abc123",
    version: 2,
    format: "markup",
    source:
      '<Helmet><Import name="sales" src="ref:data01"/><Value name="n" type="number"/><Mutation name="updateValue">{`update sales.rows set value=$n`}</Mutation></Helmet>',
    document: null,
    user_id: "owner",
    group_id: null,
    token_id: "token",
    visibility: "private",
    link_role: "viewer",
    edit_id: "actual-head-edit",
  };
  const dataset: LegacyArtifact = {
    ...page,
    id: "data01",
    version: 3,
    format: "dataset",
    source: null,
    meta: {
      catalog: {
        kind: "stored",
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: [
              { name: "value", type: "number" },
              { name: "who", type: "user", constraints: { self: true } },
            ],
            objectKey: "dataset/" + sha.slice(0, 32),
          },
        ],
      },
    },
  };
  const source: MigrationJobSource = {
    manifest: {
      schemaVersion: 2,
      sourceNamespace: "fixture",
      schema: "legacy",
      exportedAt: "epoch",
      parts: [],
    },
    base,
    maps: {
      pages: { abc123: "abc123", data01: "data01" },
      users: { owner: "owner@example.test" },
      tokens: { token: "owner@example.test" },
      groups: {},
    },
    ids: ["abc123", "data01"],
    identitySummary: {},
    groupSummary: {},
    media: null,
    datasets: {
      receipts: [
        {
          objectKey: "dataset/" + sha.slice(0, 32),
          status: "copied",
          sha256: sha,
          bytes: 2,
        },
      ],
      relations: [],
      provenance: {
        baseManifestSha256: "a".repeat(64),
        relationManifestSha256: "b".repeat(64),
        relationExportedAt: "2026-10-22T00:00:00Z",
      },
      verifiedObjects: 1,
      verifiedBytes: 2,
    },
    readArtifact: async (id): Promise<MigrationManifest> =>
      id === "abc123"
        ? {
            ...base,
            artifacts: [page],
            tables: {
              artifact_versions: [
                {
                  artifact_id: "abc123",
                  version: 1,
                  format: "markup",
                  source: page.source,
                },
              ],
            },
          }
        : { ...base, artifacts: [dataset], tables: {} },
  };
  const options: MigrationJobOptions = {
    sourceDirectory: "unused",
    indexDirectory: "unused",
    reportPath: "unused",
    schema: "isolated",
    apply: false,
    concurrency: 1,
    origin: "https://new.example.test",
    legacyOrigins: [],
    editorManageRestricted: true,
    conversionStrategy: "archived-functional",
  };
  let compilations = 0;
  const moduleInfo = await readBackendModule(generatedDatasetBackendSource);
  const backendSchema = boundedBackendSchema(moduleInfo.typeDefs);
  const deployment = sealDeployment(
    generatedDatasetBackendSource,
    "compiled fixture",
    {
      typeDefs: moduleInfo.typeDefs,
      fields: [
        ...Object.keys(backendSchema.getQueryType()?.getFields() ?? {}),
        ...Object.keys(backendSchema.getMutationType()?.getFields() ?? {}),
      ],
    },
  );
  const plan = await prepareMigrationJobDatasets(source, options, {
    host: {
      compile: async () => {
        compilations++;
        return deployment;
      },
      invoke: async () => null,
    },
  });
  assert.ok(plan);
  assert.equal(compilations, 1);
  assert.equal(plan.omittedUnmappedTokenPrincipals, 1);
  assert.equal(plan.metadata.bindings.length, 1);
  assert.equal(plan.metadata.operations?.length, 1);
  const browser = plan.mutations.get(JSON.stringify(["abc123", 2]))![0]!;
  assert.equal(browser.name, "updateValue");
  assert.deepEqual(Object.keys(browser).sort(), [
    "backendNamespace",
    "name",
    "paramTypes",
    "recoveryScope",
  ]);
  assert.match(browser.recoveryScope, /^[a-f0-9]{64}$/);
  assert.equal("sql" in browser, false);
  assert.equal("target" in browser, false);
  assert.equal("sourceNamespace" in browser, false);
  assert.equal(plan.mutations.has(JSON.stringify(["abc123", 1])), false);
  assert.equal(
    plan.metadata.operations?.[0]?.operation.page.editId,
    "actual-head-edit",
  );
  assert.equal(plan.metadata.bindings[0]!.mode, "live");
  assert.equal(plan.metadata.pages[0]!.snapshot.editId, "actual-head-edit");
  assert.equal(plan.bindings.has(JSON.stringify(["abc123", 1])), false);
  assert.equal(
    plan.bindings.get(JSON.stringify(["abc123", 2]))![0]!.name,
    "sales",
  );
  assert.deepEqual(
    plan.backends.get("abc123")!.map((r) => r.linked),
    [false, true],
  );
  assert.match(plan.allocation.inventorySha256, /^[a-f0-9]{64}$/);
  const boundSource = {
    ...source,
    readArtifact: async (id: string) => {
      const artifact = await source.readArtifact(id);
      if (id !== page.id) return artifact;
      const clone = structuredClone(artifact);
      clone.artifacts[0]!.source =
        '<Helmet><Import name="sales" src="ref:data01"/><Value name="who" source="ref:data01" column="who"/><Mutation name="choose">{`update sales.rows set who=$who`}</Mutation></Helmet>';
      return clone;
    },
  };
  const bound = await prepareMigrationJobDatasets(boundSource, options, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  assert.deepEqual(
    bound!.boundValueColumns.get(JSON.stringify(["abc123", 2])),
    [
      {
        valueName: "who",
        sourceRef: "ref:data01",
        version: 3,
        bindingName: "sales",
        schema: "public",
        table: "rows",
        column: "who",
        type: "user",
        constraints: { self: true },
      },
    ],
  );
  assert.equal(bound!.metadata.personBindings?.length, 1);
  assert.equal(
    bound!.metadata.operations?.[0]!.operation.paramTypes.who,
    "user",
  );
  assert.deepEqual(bound!.metadata.profiles, [
    { legacyUserId: "owner", name: "owner", handle: null, image: null },
  ]);
  assert.equal(bound!.metadata.personBindings![0]!.valueName, "who");
  assert.equal("constraints" in bound!.metadata.personBindings![0]!, false);
  assert.equal(
    bound!.boundValueColumns.has(JSON.stringify(["abc123", 1])),
    false,
  );
  const uploadSource = {
    ...source,
    readArtifact: async (id: string) => {
      const artifact = await source.readArtifact(id);
      if (id !== page.id) return artifact;
      const clone = structuredClone(artifact);
      clone.artifacts[0]!.source =
        page.source!.replace(
          "</Helmet>",
          '<Value name="files" type="string"/></Helmet>',
        ) + '<FileUpload dataset="sales" value="$files" accept="image/png"/>';
      return clone;
    },
  };
  const uploads = await prepareMigrationJobDatasets(uploadSource, options, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  assert.deepEqual([...uploads!.issues], []);
  assert.equal(uploads!.metadata.operations?.length, 1);
  assert.equal(uploads!.metadata.attachments?.length, 1);
  assert.equal(uploads!.metadata.attachments![0]!.binding.page.version, 2);
  assert.deepEqual(
    uploads!.datasetAttachments?.get(JSON.stringify(["abc123", 2])),
    [{ backendNamespace: "legacyData", bindingName: "sales" }],
  );
  assert.equal(
    uploads!.datasetAttachments?.has(JSON.stringify(["abc123", 1])),
    false,
  );
  const invalidUpload = await prepareMigrationJobDatasets(
    {
      ...source,
      readArtifact: async (id: string) => {
        const artifact = await source.readArtifact(id);
        if (id !== page.id) return artifact;
        const clone = structuredClone(artifact);
        clone.artifacts[0]!.source =
          page.source +
          '<Value name="files" type="string"/><FileUpload dataset="sales" value="$files" accept="image/png"/>';
        return clone;
      },
    },
    options,
    { host: { compile: async () => deployment, invoke: async () => null } },
  );
  assert.deepEqual(invalidUpload!.issues.get("abc123"), [
    "mutation-publication",
  ]);
  assert.deepEqual(invalidUpload!.metadata.attachments, []);
  assert.equal(
    invalidUpload!.datasetAttachments?.has(JSON.stringify(["abc123", 2])),
    false,
  );
  const memberSource = {
    ...source,
    datasets: {
      ...source.datasets!,
      relations: [
        {
          subject_kind: "user",
          subject_id: "owner",
          verb: "join",
          object_kind: "artifact",
          object_id: "abc123",
          status: "accepted",
          accepted_at: "2026-10-21T12:30:00+05:30",
        },
      ],
    },
    readArtifact: async (id: string) => {
      const artifact = await source.readArtifact(id);
      if (id !== page.id) return artifact;
      const clone = structuredClone(artifact);
      clone.artifacts[0]!.source =
        '<Helmet><Query name="people">{`select user_id,joined_at from _members`}</Query></Helmet>';
      clone.tables.artifact_versions = [];
      return clone;
    },
  };
  const member = await prepareMigrationJobDatasets(memberSource, options, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  assert.ok(member);
  assert.equal(member.issues.size, 0);
  assert.equal(member.metadata.bindings.length, 0);
  assert.equal(member.metadata.pages.length, 1);
  assert.deepEqual(member.metadata.acceptedJoins, [
    {
      pageId: "abc123",
      legacyUserId: "owner",
      joinedAt: "2026-10-21T07:00:00.000Z",
    },
  ]);
  const receipt = member.backends.get("abc123")![0]!;
  assert.deepEqual(receipt.members, { sourceNamespace: "fixture" });
  assert.deepEqual(member.membersBindings.get(JSON.stringify(["abc123", 2])), {
    backendNamespace: receipt.backendNamespace,
    backendHref: new URL(receipt.backendHref).pathname,
  });
  assert.equal(
    member.membersBindings.has(JSON.stringify(["abc123", 1])),
    false,
  );
  const viewerSource = {
    ...source,
    readArtifact: async (id: string) => {
      const artifact = await source.readArtifact(id);
      if (id !== page.id) return artifact;
      const clone = structuredClone(artifact);
      clone.artifacts[0]!.source = '<p data-af-id="reader">{$_me.id}</p>';
      clone.tables.artifact_versions = [
        {
          artifact_id: page.id,
          version: 1,
          format: "markup",
          source: "<p>{$_me.id}</p>",
        },
      ];
      return clone;
    },
  };
  const viewer = await prepareMigrationJobDatasets(viewerSource, options, {
    host: { compile: async () => deployment, invoke: async () => null },
  });
  assert.ok(viewer);
  assert.equal(viewer.issues.size, 0);
  assert.equal(viewer.scan.statistics.pagesWithViewer, 1);
  assert.equal(viewer.metadata.bindings.length, 0);
  assert.equal(viewer.metadata.acceptedJoins.length, 0);
  assert.equal(
    viewer.metadata.principals.some(
      (p) => p.kind === "user" && p.legacyId === "owner",
    ),
    true,
  );
  const viewerReceipts = viewer.backends.get("abc123")!;
  assert.deepEqual(
    viewerReceipts.map((r) => r.viewer),
    [undefined, { sourceNamespace: "fixture" }],
  );
  assert.deepEqual(viewer.viewerBindings.get(JSON.stringify(["abc123", 2])), {
    backendNamespace: "legacyData",
    backendHref: new URL(viewerReceipts.find((r) => r.viewer)!.backendHref)
      .pathname,
  });
  assert.equal(viewer.viewerBindings.has(JSON.stringify(["abc123", 1])), false);
  assert.deepEqual(viewer.scan.historicalServiceVersions.get("abc123"), [1]);
  const presentationSource = {
    ...source,
    readArtifact: async (id: string) => {
      const artifact = structuredClone(await source.readArtifact(id));
      if (id === page.id) artifact.artifacts[0]!.source = '<Helmet><Import name="sales" src="ref:data01"/><Query name="base">{`select value,who from sales.rows`}</Query><Mutation name="save" expectedAffected={1}>{`update sales.rows set who=$_value where value=$_row.value`}</Mutation></Helmet><DataTable data="$base" rowKey="value"><Column col="who"><input style={{width:120}} value="$_row.who" run="$save"/></Column></DataTable>';
      return artifact;
    },
  };
  const presentationHost = {host: {compile: async () => deployment, invoke: async () => null}};
  const strictPresentation = await prepareMigrationJobDatasets(presentationSource, options, presentationHost);
  assert.equal(strictPresentation!.metadata.operations?.length ?? 0, 0);
  const prototypePresentation = await prepareMigrationJobDatasets(presentationSource, {...options, sourceAdmission:'offline-prototype'}, presentationHost);
  assert.equal(prototypePresentation!.metadata.operations?.length, 1);
  assert.equal(prototypePresentation!.metadata.operations?.[0]!.operation.valueParam?.type, 'user');
  assert.equal(prototypePresentation!.issues.has(page.id), false);

});
