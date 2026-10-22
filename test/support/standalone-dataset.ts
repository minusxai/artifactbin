import { createHash } from "node:crypto";
import { datasetPageArtifactSha256 } from "../../src/migration/dataset-pages/scan.ts";
import { boundedBackendSchema } from "../../src/graphql/execution-policy.ts";
import { sealDeployment } from "../../src/backend/deployment.ts";
import { readBackendModule } from "../../src/backend/af-module.ts";
import type {
  MigrationJobSource,
  MigrationJobOptions,
} from "../../src/migration/job-contracts.ts";
import type {
  LegacyArtifact,
  MigrationManifest,
} from "../../src/migration/contracts.ts";
const sha = createHash("sha256").update("[]").digest("hex");
export function standaloneDatasetFixture(external = false) {
  const artifact: LegacyArtifact = {
    id: "data01",
    version: 1,
    format: "dataset",
    source: null,
    document: null,
    user_id: "owner",
    group_id: null,
    token_id: null,
    title: "Table",
    visibility: "private",
    link_role: "viewer",
    edit_id: "dataset-edit",
    meta: {
      catalog: {
        kind: external ? "postgres" : "stored",
        tables: [
          {
            schema: "public",
            name: "rows",
            columns: [{ name: "n", type: "number" }],
            ...(external ? {} : { objectKey: "dataset/" + sha.slice(0, 32) }),
          },
        ],
      },
    },
  };
  const base: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "2026-01-01T00:00:00Z",
    artifacts: [],
    tokenOwners: [],
    tables: {
      users: [{ id: "owner", email: "owner@example.test", kind: "user" }],
    },
  };
  const source: MigrationJobSource = {
    manifest: {
      schemaVersion: 2,
      sourceNamespace: "fixture",
      schema: "legacy",
      exportedAt: base.exportedAt,
      parts: [],
    },
    base,
    maps: {
      pages: { data01: "Data01", deleted: "Gone01" },
      users: { owner: "owner@example.test" },
      tokens: {},
      groups: {},
    },
    ids: ["data01"],
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
        relationExportedAt: base.exportedAt,
      },
      verifiedObjects: 1,
      verifiedBytes: 2,
    },
    readArtifact: async () => ({ ...base, artifacts: [artifact], tables: {} }),
  };
  const options: MigrationJobOptions = {
    sourceDirectory: "unused",
    indexDirectory: "unused",
    schema: "fixture",
    reportPath: "unused",
    apply: false,
    concurrency: 1,
    origin: "https://example.test",
    legacyOrigins: [],
    editorManageRestricted: true,
    conversionStrategy: "archived-functional",
    standaloneDatasetPages: {
      kind: "standalone-dataset-pages-v1",
      sourceNamespace: "fixture",
      heads: [
        {
          legacyId: artifact.id,
          version: artifact.version,
          artifactSha256: datasetPageArtifactSha256(artifact),
        },
      ],
      reservedFileIds: ["Data01", "Gone01", "Back01"],
      base: {
        verificationReport: { path: "unused", sha256: "a".repeat(64) },
        inventory: {
          sourceNamespace: "fixture",
          resources: [],
          datasetFingerprint: "a".repeat(64),
          baseManifestSha256: "a".repeat(64),
          relationManifestSha256: "b".repeat(64),
          relationExportedAt: base.exportedAt,
          compilerIdentity: "fixture",
          reservedFileIds: [],
          backendRows: [],
          protectedRows: [],
          pageReceipts: [],
          sources: [],
          tables: [],
        },
      },
    },
  };
  return { artifact, source, options };
}
export const standaloneDatasetHost = {
  async invoke(): Promise<never> {
    throw Error("offline preparation must not invoke a resolver");
  },
  async compile(source: string) {
    const info = await readBackendModule(source);
    return sealDeployment(source, "inert test bundle", {
      typeDefs: info.typeDefs,
      fields: [
        ...Object.keys(
          boundedBackendSchema(info.typeDefs).getQueryType()?.getFields() ?? {},
        ),
        ...Object.keys(
          boundedBackendSchema(info.typeDefs).getMutationType()?.getFields() ??
            {},
        ),
      ],
    });
  },
};
