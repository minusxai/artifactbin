import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureFontJob } from "../src/migration/conversion/compiled/fonts/capture.ts";
import { verifyCapturedFontBundle } from "../src/migration/conversion/compiled/fonts/verify.ts";
test("immutable capture replay verifies original CSS, descriptors and every font byte before returning a cache identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "font-bundle-"));
  try {
    const request =
        "https://fonts.googleapis.com/css2?family=Example:ital,wght@0,400;1,400&display=swap",
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
    const verified = await verifyCapturedFontBundle({
      directory,
      manifestSha256,
    });
    assert.match(verified.resourceDigest, /^[a-f0-9]{64}$/);
    assert.equal(verified.files.size, 2);
    assert.equal(verified.manifest.stylesheets[0]?.omittedRequests?.length, 1);
    const tampered = JSON.parse(manifest);
    tampered.stylesheets[0].omittedRequests = [];
    const changedManifest = JSON.stringify(tampered);
    await writeFile(path.join(directory, "manifest.json"), changedManifest);
    await assert.rejects(() =>
      verifyCapturedFontBundle({
        directory,
        manifestSha256: createHash("sha256")
          .update(changedManifest)
          .digest("hex"),
      }),
    );
    await writeFile(path.join(directory, "manifest.json"), manifest);

    const font = [...job.files.keys()].find((n) => n.endsWith(".woff2"))!;
    const corrupt = Buffer.from(bytes);
    corrupt[47] = 1;
    await writeFile(path.join(directory, font), corrupt);
    await assert.rejects(() =>
      verifyCapturedFontBundle({ directory, manifestSha256 }),
    );
    await writeFile(path.join(directory, font), bytes);
    await writeFile(path.join(directory, "manifest.json"), manifest + " ");
    await assert.rejects(() =>
      verifyCapturedFontBundle({ directory, manifestSha256 }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("bundle verifier refuses FIFOs and leaf symlinks before reading", async () => {
  const { execFileSync } = await import("node:child_process"),
    { symlink } = await import("node:fs/promises");
  const directory = await mkdtemp(path.join(tmpdir(), "font-bundle-special-"));
  try {
    const file = path.join(directory, "manifest.json");
    execFileSync("mkfifo", [file]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await assert.rejects(
        () =>
          Promise.race([
            verifyCapturedFontBundle({
              directory,
              manifestSha256: "a".repeat(64),
            }),
            new Promise((_, reject) => {
              timeout = setTimeout(
                () => reject(Error("blocked special file")),
                1000,
              );
            }),
          ]),
        (error) =>
          !(error instanceof Error && error.message === "blocked special file"),
      );
    } finally {
      clearTimeout(timeout);
    }
    await rm(file);
    await writeFile(path.join(directory, "actual.json"), "{}");
    await symlink("actual.json", file);
    await assert.rejects(() =>
      verifyCapturedFontBundle({
        directory,
        manifestSha256: createHash("sha256").update("{}").digest("hex"),
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
