import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureFontJob } from "../src/migration/conversion/compiled/fonts/capture.ts";
import { cachedMigrationConverter } from "../src/migration/cache.ts";
import { migrationCompilerIdentity } from "../src/migration/compiler-identity.ts";

test("verified font closure cannot be bypassed by an injected compiler identity and is rechecked", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "migration-resource-identity-"),
  );
  try {
    const request =
        "https://fonts.googleapis.com/css2?family=Example:wght@400&display=swap",
      css = `@font-face{font-family:'Example';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/example/v1/a.woff2) format('woff2');unicode-range:U+0000-00FF}`,
      bytes = Buffer.alloc(52);
    bytes.write("wOF2");
    bytes.writeUInt32BE(0x10000, 4);
    bytes.writeUInt16BE(1, 12);
    bytes.writeUInt32BE(2, 20);
    bytes[48] = 0;
    bytes[49] = 100;
    bytes.writeUInt32BE(52, 8);
    bytes.writeUInt32BE(128, 16);
    const job = await captureFontJob([request], {
      fetch: async (_url, kind) =>
        kind === "stylesheet" ? Buffer.from(css) : bytes,
      inspect: async () => ({
        families: ["Example"],
        axes: [],
        weight: 400,
        style: "normal",
      }),
      now: () => 0,
      schedule: () => () => {},
    });
    for (const [name, data] of job.files) {
      await mkdir(path.dirname(path.join(directory, name)), {
        recursive: true,
      });
      await writeFile(path.join(directory, name), data);
    }
    const manifest = JSON.stringify(job.manifest),
      manifestSha256 = createHash("sha256").update(manifest).digest("hex");
    await writeFile(path.join(directory, "manifest.json"), manifest);

    const options = { fontBundle: { directory, manifestSha256 } };
    let calls = 0;
    const base = async () => {
      calls++;
      return "fixed-compiler";
    };
    const first = await migrationCompilerIdentity(options, base);
    assert.notEqual(first, "fixed-compiler");
    assert.equal(first, await migrationCompilerIdentity(options, base));
    const changedManifest = JSON.stringify({
      ...job.manifest,
      capturedAt: new Date(1).toISOString(),
    });
    await writeFile(path.join(directory, "manifest.json"), changedManifest);
    const changedOptions = {
      fontBundle: {
        directory,
        manifestSha256: createHash("sha256")
          .update(changedManifest)
          .digest("hex"),
      },
    };
    const changed = await migrationCompilerIdentity(changedOptions, base);
    assert.notEqual(first, changed);
    let conversions = 0;
    const convert = () => {
      conversions++;
      return {
        classification: "renderable" as const,
        html: "<p>same source</p>",
        issues: [],
        identities: {},
      };
    };
    const cacheDirectory = path.join(directory, "cache");
    const input = { source: "same source", coreUrl: "/af/v1/core.js" };
    const initialCache = cachedMigrationConverter(convert, {
      directory: cacheDirectory,
      compilerIdentity: first,
      strategy: "archived-static",
    });
    await initialCache.convert(input);
    await initialCache.convert(input);
    assert.equal(conversions, 1);
    const changedCache = cachedMigrationConverter(convert, {
      directory: cacheDirectory,
      compilerIdentity: changed,
      strategy: "archived-static",
    });
    await changedCache.convert(input);
    assert.equal(
      conversions,
      2,
      "changed verified manifest must miss the same-source cache",
    );
    await assert.rejects(() => migrationCompilerIdentity(options, base));
    const font = [...job.files.keys()].find((name) => name.endsWith(".woff2"))!;
    await writeFile(path.join(directory, font), Buffer.alloc(52));
    const before = calls;
    await assert.rejects(() => migrationCompilerIdentity(changedOptions, base));
    assert.equal(
      calls,
      before,
      "invalid resources must fail before even consulting compiler/cache identity",
    );
    await writeFile(path.join(directory, font), job.files.get(font)!);
    const cssFile = [...job.files.keys()].find((name) =>
      name.endsWith(".css"),
    )!;
    await writeFile(path.join(directory, cssFile), "/* tampered */");
    await assert.rejects(() => migrationCompilerIdentity(changedOptions, base));
    assert.equal(calls, before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("audited SQL type admissions partition conversion cache identity", async () => {
  const identify = async () => "same-compiler";
  const admission = {
    version: "duckdb-list-v1" as const,
    sqlSha256: "a".repeat(64),
    listExpressions: ["people"],
    numericExpressions: [],
  };
  const base = await migrationCompilerIdentity({}, identify);
  const admitted = await migrationCompilerIdentity(
    { legacyDuckSqlAdmissions: [admission] },
    identify,
  );
  assert.notEqual(base, admitted);
  assert.notEqual(
    admitted,
    await migrationCompilerIdentity(
      {
        legacyDuckSqlAdmissions: [{ ...admission, listExpressions: ["other"] }],
      },
      identify,
    ),
  );
});
