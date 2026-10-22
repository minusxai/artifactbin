import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  planMigration,
  applyMigration,
  migrationPageDigest,
} from "../src/migration/import.ts";
import type {
  MigrationManifest,
  Converter,
  ImportDestination,
  ConversionOutput,
} from "../src/migration/contracts.ts";
const maps = {
  pages: { abc123: "abc123" },
  users: { owner: "owner@example.test" },
  groups: {},
  tokens: {},
};
function fixture(): MigrationManifest {
  return {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    tokenOwners: [],
    tables: {
      artifact_versions: [
        {
          artifact_id: "abc123",
          version: 1,
          format: "markup",
          source:
            '<script>throw "synthetic-secret"</script><img src="https://outside.example/leak">',
          document: {
            hostile: "</script><script>fetch('/credentials')</script>",
          },
        },
      ],
    },
    artifacts: [
      {
        id: "abc123",
        version: 2,
        format: "markup",
        user_id: "owner",
        group_id: null,
        token_id: null,
        source: "current",
        document: null,
        visibility: "private",
        link_role: "viewer",
      },
    ],
  };
}
const convert: Converter = ({ source }): ConversionOutput =>
  source === "current"
    ? {
        classification: "functional",
        html: '<!doctype html><html><body><p data-af-id="current">Current</p></body></html>',
        issues: [],
        identities: { current: "current" },
      }
    : {
        classification: "manual-blocked",
        html: null,
        issues: [{ code: "compiled-source", message: "synthetic-secret" }],
        identities: {},
        receipt: {
          compilerIdentity: "a".repeat(64),
          inputSha256: "b".repeat(64),
          outputSha256: "c".repeat(64),
        },
      };
test("explicit policy retains every version and original while making unsupported history visibly unavailable", async () => {
  const source = fixture(),
    before = JSON.stringify(source);
  const strict = await planMigration(source, {
    maps,
    convert,
    coreUrl: "/af/v1/core.js",
  });
  assert.equal(strict.pages[0]!.disposition, "blocked");
  const plan = await planMigration(source, {
    maps,
    convert,
    coreUrl: "/af/v1/core.js",
    historicalUnavailable: "preserve",
  });
  const page = plan.pages[0]!;
  assert.equal(page.disposition, "ready");
  assert.deepEqual(
    page.revisions.map((r) => r.version),
    [1, 2],
  );
  const old = page.revisions[0]!.conversion;
  assert.equal(old.classification, "historical-unavailable");
  assert.match(old.html!, /Historical version 1 unavailable/);
  assert.match(old.html!, /read-only/);
  assert.match(old.html!, /immutable migration archive/);
  assert.doesNotMatch(
    old.html!,
    /synthetic-secret|outside\.example|fetch\(|credentials|throw|<img|<iframe|<form|data-af-name/,
  );
  assert.equal((old.html!.match(/<script/g) ?? []).length, 1);
  assert.match(old.html!, /data-af="core"/);
  assert.equal(old.receipt, undefined);
  assert.equal(
    old.historicalUnavailable!.failedConversionReceipt!.compilerIdentity,
    "a".repeat(64),
  );
  assert.equal(
    old.historicalUnavailable!.originalSourceSha256,
    createHash("sha256")
      .update(String(source.tables.artifact_versions![0]!.source))
      .digest("hex"),
  );
  assert.equal(page.revisions[1]!.conversion.classification, "functional");
  assert.equal(
    page.revisions[0]!.original,
    source.tables.artifact_versions![0],
  );
  assert.equal(JSON.stringify(source), before);
  assert.equal(plan.archive, source);
  const again = await planMigration(source, {
    maps,
    convert,
    coreUrl: "/af/v1/core.js",
    historicalUnavailable: "preserve",
  });
  assert.equal(migrationPageDigest(page), migrationPageDigest(again.pages[0]!));
  assert.equal(old.html, again.pages[0]!.revisions[0]!.conversion.html);
  const receipts = new Map<string, string>();
  const destination: ImportDestination = {
    supportsExactAccess: () => true,
    importPage: async (k, d) => {
      if (receipts.has(k)) {
        assert.equal(receipts.get(k), d);
        return "unchanged";
      }
      receipts.set(k, d);
      return "created";
    },
  };
  assert.equal(
    (await applyMigration(plan, destination, { dryRun: false })).created,
    1,
  );
  assert.equal(
    (await applyMigration(again, destination, { dryRun: false })).unchanged,
    1,
  );
});
test("policy never substitutes the current head and never changes supported historical output", async () => {
  const m = fixture();
  m.artifacts[0]!.source = "bad-current";
  const blocked = await planMigration(m, {
    maps,
    convert,
    coreUrl: "/af/v1/core.js",
    historicalUnavailable: "preserve",
  });
  assert.equal(blocked.pages[0]!.disposition, "blocked");
  assert.equal(
    blocked.pages[0]!.revisions[1]!.conversion.classification,
    "manual-blocked",
  );
  assert.equal(blocked.pages[0]!.revisions[1]!.conversion.html, null);
  m.artifacts[0]!.source = "current";
  m.tables.artifact_versions![0]!.source = "current";
  const supported = await planMigration(m, {
    maps,
    convert,
    coreUrl: "/af/v1/core.js",
    historicalUnavailable: "preserve",
  });
  assert.equal(
    supported.pages[0]!.revisions[0]!.conversion.classification,
    "functional",
  );
  assert.equal(
    supported.pages[0]!.revisions[0]!.conversion.historicalUnavailable,
    undefined,
  );
});
