import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedMigrationConverter } from "../src/migration/cache.ts";
const input = { source: "<p>exact source</p>", coreUrl: "/af/v1/core.js" };
const result = {
  classification: "functional" as const,
  html: "<p>compiled</p>",
  issues: [],
  identities: {},
};
test("retained successful exact-input output preserves actual compiler receipt; changed input and unknown compilers compile again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "retained-cache-"));
  try {
    const prior = cachedMigrationConverter(async () => result, {
      directory,
      compilerIdentity: "prior",
      strategy: "archived-functional",
    });
    const first = await prior.convert(input);
    let calls = 0;
    const current = cachedMigrationConverter(
      async () => {
        calls++;
        return result;
      },
      {
        directory,
        compilerIdentity: "current",
        retainedCompilerIdentities: ["prior"],
        strategy: "archived-functional",
      },
    );
    const retained = await current.convert(input);
    assert.equal(calls, 0);
    assert.equal(retained.receipt?.compilerIdentity, "prior");
    assert.deepEqual(retained.receipt, first.receipt);
    assert.match(retained.receipt!.inputSha256, /^[a-f0-9]{64}$/);
    assert.match(retained.receipt!.outputSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      (await current.convert({ ...input, meta: { theme: "changed" } })).receipt
        ?.compilerIdentity,
      "current",
    );
    assert.equal(calls, 1);
    await cachedMigrationConverter(
      async () => {
        calls++;
        return result;
      },
      {
        directory,
        compilerIdentity: "unrelated",
        strategy: "archived-functional",
      },
    ).convert(input);
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("prior failures, changed strategy and corrupted successful records are never retained", async () => {
  const directory = await mkdtemp(join(tmpdir(), "retained-cache-"));
  try {
    await cachedMigrationConverter(
      async () => ({ ...result, classification: "manual-blocked", html: null }),
      {
        directory,
        compilerIdentity: "failed",
        strategy: "archived-functional",
      },
    ).convert(input);
    await cachedMigrationConverter(async () => result, {
      directory,
      compilerIdentity: "static",
      strategy: "archived-static",
    }).convert(input);
    let calls = 0;
    await cachedMigrationConverter(
      async () => {
        calls++;
        return result;
      },
      {
        directory,
        compilerIdentity: "current",
        retainedCompilerIdentities: ["failed", "static"],
        strategy: "archived-functional",
      },
    ).convert(input);
    assert.equal(calls, 1);
    const dir2 = join(directory, "corrupt");
    await cachedMigrationConverter(async () => result, {
      directory: dir2,
      compilerIdentity: "prior",
      strategy: "archived-functional",
    }).convert(input);
    const path = join(dir2, (await readdir(dir2))[0]!);
    const record = JSON.parse(await readFile(path, "utf8"));
    record.result.html = "changed";
    await writeFile(path, JSON.stringify(record));
    await cachedMigrationConverter(
      async () => {
        calls++;
        return result;
      },
      {
        directory: dir2,
        compilerIdentity: "current",
        retainedCompilerIdentities: ["prior"],
        strategy: "archived-functional",
      },
    ).convert(input);
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
