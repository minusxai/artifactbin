import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  admitNativeProgram,
  nativeProgramSourceSha256,
  nativeProgramExclusion,
  validateNativeProgramExclusions,
} from "../src/migration/programs/native-admission.ts";
import { planMigration } from "../src/migration/import.ts";
import { planMigrationJob } from "../src/migration/job-planning.ts";
import type {
  MigrationJobSource,
  MigrationJobOptions,
} from "../src/migration/job-contracts.ts";
import type { MigrationManifest } from "../src/migration/contracts.ts";
const source = (code: string) =>
  JSON.stringify({
    version: 1,
    command: ["node", "-e", code],
    compute: { vcpu: 1, memoryMiB: 2048, ttlSeconds: 60 },
  });
test("native admission distinguishes exact resolver grammar, remote capabilities, invalid source and unknown pure syntax", async () => {
  assert.equal(
    (
      await admitNativeProgram(
        source("console.log(process.env.ARTIFACTBIN_INPUT)"),
      )
    ).kind,
    "resolver-compatible",
  );
  for (const code of [
    "setTimeout(()=>{},30000)",
    "require('node:fs')",
    "console.log(process.getuid())",
    "console.log(process.env.SETTING)",
  ]) {
    const result = await admitNativeProgram(source(code));
    assert.equal(result.kind, "remote-runtime-required");
  }
  assert.equal((await admitNativeProgram("not JSON")).kind, "invalid-source");
  assert.equal(
    (await admitNativeProgram(source("const ="))).kind,
    "invalid-source",
  );
  assert.equal(
    (await admitNativeProgram(source("console.log(1+1)"))).kind,
    "unsupported-source",
  );
  const malformed = JSON.parse(source("setTimeout(()=>{},30000)"));
  malformed.compute.memoryMiB = 1;
  assert.equal(
    (await admitNativeProgram(JSON.stringify(malformed))).kind,
    "invalid-source",
  );
});
test("product exclusions require exact original UTF8 digest and a proven remote-runtime requirement", async () => {
  const text = source("setTimeout(()=>{},30000)");
  const decision = {
    sourceSha256: nativeProgramSourceSha256(text),
    decision: "remote-agent-runtime-not-migrated" as const,
  };
  assert.deepEqual(await nativeProgramExclusion(text, [decision]), {
    ...decision,
    format: "program",
    reason: "remote-runtime-required",
  });
  assert.equal(
    await nativeProgramExclusion(text + "\n", [decision]),
    undefined,
  );
  assert.equal(await nativeProgramExclusion(text, []), undefined);
  for (const code of ["console.log('ready')", "console.log(1+1)"]) {
    const candidate = source(code);
    await assert.rejects(
      nativeProgramExclusion(candidate, [
        { ...decision, sourceSha256: nativeProgramSourceSha256(candidate) },
      ]),
      /does not identify/,
    );
  }
  assert.throws(
    () => validateNativeProgramExclusions([decision, decision]),
    /Invalid/,
  );
  assert.throws(() => validateNativeProgramExclusions({} as any), /Invalid/);
});
test("an approved native exclusion creates no product page and is separately counted in corpus readiness reports", async () => {
  const text = source("setTimeout(()=>{},30000)");
  const decision = {
    sourceSha256: nativeProgramSourceSha256(text),
    decision: "remote-agent-runtime-not-migrated" as const,
  };
  const manifest: MigrationManifest = {
    schemaVersion: 1,
    sourceNamespace: "fixture",
    exportedAt: "epoch",
    artifacts: [
      {
        id: "abc123",
        format: "program",
        version: 2,
        source: text,
        document: null,
        user_id: "owner",
        group_id: null,
        token_id: null,
        visibility: "private",
        link_role: "viewer",
      },
    ],
    tokenOwners: [],
    tables: {
      users: [{ id: "owner", kind: "user" }],
      artifact_versions: [
        {
          artifact_id: "abc123",
          version: 1,
          format: "program",
          source: source("console.log('historical output')"),
          document: null,
        },
      ],
    },
  };
  const maps = {
    pages: { abc123: "abc123" },
    users: { owner: "owner@example.test" },
    groups: {},
    tokens: {},
  };
  let converted = 0,
    imported = 0;
  const plan = await planMigration(manifest, {
    maps,
    coreUrl: "/af/v1/core.js",
    excludedNativeProgramSources: [decision],
    convert: async () => {
      converted++;
      throw Error("Excluded source must not convert");
    },
  });
  assert.equal(plan.pages.length, 0);
  assert.equal(converted, 0);
  assert.equal(plan.archive, manifest);
  assert.equal(plan.archive.tables.artifact_versions?.length, 1);
  assert.equal(plan.excludedNativePrograms?.length, 1);
  const withoutDecision = await planMigration(manifest, {
    maps,
    coreUrl: "/af/v1/core.js",
    convert: async () => {
      throw Error("Unexpected markup conversion");
    },
  });
  assert.equal(withoutDecision.pages.length, 1);
  assert.equal(withoutDecision.pages[0]!.disposition, "blocked");
  const directory = await mkdtemp(join(tmpdir(), "native-exclusion-"));
  try {
    const options = {
      reportPath: join(directory, "report.ndjson"),
      origin: "https://new.example.test",
      legacyOrigins: [],
      concurrency: 1,
      conversionStrategy: "strict",
      apply: false,
      sourceDirectory: "unused",
      indexDirectory: "unused",
      schema: "isolated",
      editorManageRestricted: true,
    } satisfies MigrationJobOptions;
    const job = await planMigrationJob(
      {
        ids: ["abc123"],
        maps,
        manifest: { sourceNamespace: "fixture" },
        readArtifact: async () => manifest,
      } as unknown as MigrationJobSource,
      options,
      async () => plan,
      {
        supportsExactAccess: () => true,
        importPage: async () => {
          imported++;
          return "created";
        },
      },
    );
    assert.equal(imported, 0);
    assert.equal(job.totalExcluded, 1);
    assert.equal(job.totals.blocked, 0);
    assert.deepEqual(job.inventory.program, {
      total: 1,
      ready: 0,
      blocked: 0,
      excluded: 1,
    });
    assert.equal(job.readinessRows.length, 0);
    const report = JSON.parse(
      (await readFile(options.reportPath, "utf8")).trim(),
    );
    assert.equal(report.disposition, "excluded");
    assert.equal(report.reason, "remote-runtime-required");
    const readiness = JSON.parse(
      await readFile(options.reportPath + ".readiness.json", "utf8"),
    );
    assert.equal(readiness.totalExcluded, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
