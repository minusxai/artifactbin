import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { writeCapturedFontJob } from "../src/migration/conversion/compiled/fonts/capture-write.ts";
test("capture publishing is private, immutable and manifest-last with no existing directory overwrite", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "font-capture-write-")),
    directory = path.join(parent, "receipt");
  try {
    const bytes = Buffer.from("fixture"),
      sha = createHash("sha256").update(bytes).digest("hex"),
      job = {
        manifest: {
          version: 1 as const,
          capturedAt: new Date(0).toISOString(),
          stylesheets: [],
        },
        files: new Map([["fonts/" + sha + ".woff2", bytes]]),
      };
    const result = await writeCapturedFontJob(job, directory);
    const manifest = await readFile(path.join(directory, "manifest.json"));
    assert.equal(
      createHash("sha256").update(manifest).digest("hex"),
      result.manifestSha256,
    );
    assert.equal(
      (await stat(path.join(directory, "manifest.json"))).mode & 0o777,
      0o600,
    );
    await assert.rejects(() => writeCapturedFontJob(job, directory));
    assert.deepEqual(
      await readFile(path.join(directory, "manifest.json")),
      manifest,
    );
    const invalid = path.join(parent, "invalid");
    await assert.rejects(() =>
      writeCapturedFontJob(
        { ...job, files: new Map([["../escape", bytes]]) },
        invalid,
      ),
    );
    await assert.rejects(() => stat(invalid));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
