import test from "node:test";
import assert from "node:assert/strict";
import { planMigration } from "../src/migration/import.ts";
import { migrationPageQueryRegistrations } from "../src/migration/query-registrations.ts";
import type { MigrationBackendReceipt } from "../src/migration/backend-preparation-contracts.ts";
import { prepareMigrationPageSources } from "../src/migration/page-source-preparation.ts";
import { sourceDigest } from "../src/server/page-ports.ts";
import { createHash } from "node:crypto";
test("query registration pins final canonical source and exact saved deployment, with distinct original-flow and module provenance", async () => {
  const plan = await planMigration(
    {
      schemaVersion: 1,
      sourceNamespace: "fixture",
      exportedAt: "epoch",
      tables: {},
      tokenOwners: [],
      artifacts: [
        {
          id: "abc123",
          version: 2,
          format: "markup",
          source: "original",
          document: null,
          user_id: "owner",
          group_id: null,
          token_id: null,
          visibility: "private",
          link_role: "viewer",
        },
      ],
    },
    {
      maps: {
        pages: { abc123: "abc123" },
        users: { owner: "owner@example.test" },
        tokens: {},
        groups: {},
      },
      coreUrl: "/af/v1/core.js",
      convert: async () => ({
        classification: "renderable",
        html: '<!doctype html><html><head><script data-af="core" src="/af/v1/core.js"></script></head><body><p data-af-id="node">Kept</p></body></html>',
        identities: { node: "node" },
        issues: [],
      }),
    },
  );
  const page = plan.pages[0]!;
  page.serverQueries = [
    {
      pageVersion: 2,
      moduleSourceSha256: "a".repeat(64),
      flowSourceSha256: "b".repeat(64),
      compilerIdentity: "c".repeat(64),
      plan: {
        queries: [{ name: "q", sql: "select 1", dependencies: [] }],
        scalars: {},
        tables: [],
        imports: [],
      },
    },
  ];
  page.backends = [
    {
      pageVersion: 2,
      backendId: "def456",
      linked: true,
      deployment: { version: "compiled-version" },
    } as MigrationBackendReceipt,
  ];
  const result = migrationPageQueryRegistrations(
    page,
    "fixture",
    "https://example.test",
  );
  assert.equal(result[0]!.plan.registration.backendVersion, "compiled-version");
  assert.equal(
    result[0]!.plan.registration.sourceSha256,
    sourceDigest(prepareMigrationPageSources(page, "https://example.test")[0]!.prepared.source),
  );
  assert.notEqual(
    result[0]!.plan.registration.sourceSha256,
    result[0]!.moduleSourceSha256,
  );
  assert.deepEqual(result[0]!.migrationProvenance, {
    flowSourceSha256: "b".repeat(64),
    compilerIdentity: "c".repeat(64),
    savedSourceSha256: createHash("sha256").update(prepareMigrationPageSources(page,"https://example.test")[0]!.prepared.source).digest("hex"),
  });
  page.backends = [];
  assert.throws(
    () =>
      migrationPageQueryRegistrations(page, "fixture", "https://example.test"),
    /tuple_unavailable/,
  );
});
