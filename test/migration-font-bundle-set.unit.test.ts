import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { captureFontJob } from "../src/migration/conversion/compiled/fonts/capture.ts";
import { writeCapturedFontJob } from "../src/migration/conversion/compiled/fonts/capture-write.ts";
import { verifyCapturedFontBundle } from "../src/migration/conversion/compiled/fonts/verify.ts";
test("immutable bundle set verifies child closures, deduplicates exact receipts and refuses ambiguous or escaping children", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "font-set-"));
  try {
    const bytes = Buffer.alloc(52);
    bytes.write("wOF2");
    bytes.writeUInt32BE(0x10000, 4);
    bytes.writeUInt32BE(52, 8);
    bytes.writeUInt16BE(1, 12);
    bytes.writeUInt32BE(128, 16);
    bytes.writeUInt32BE(2, 20);
    bytes[49] = 100;
    const url =
      "https://fonts.googleapis.com/css2?family=Example:wght@400&display=swap";
    const make = async (index: number, suffix: string) => {
      const job = await captureFontJob([url], {
        fetch: async (_u, k) =>
          k === "font"
            ? bytes
            : Buffer.from(
                `@font-face{font-family:'Example';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/example/v1/${suffix}.woff2) format('woff2');unicode-range:U+0000-00FF}`,
              ),
        inspect: async () => ({
          families: ["Example"],
          axes: [],
          weight: 400,
          style: "normal",
        }),
        now: () => 0,
        schedule: () => () => {},
      });
      const directory = "bundle-" + index;
      const receipt = await writeCapturedFontJob(
        job,
        path.join(root, directory),
      );
      const verified = await verifyCapturedFontBundle({
        directory: path.join(root, directory),
        ...receipt,
      });
      return { directory, ...receipt, resourceDigest: verified.resourceDigest };
    };
    const a = await make(0, "a"),
      b = await make(1, "a"),
      c = await make(2, "b");
    const check = async (bundles: unknown[]) => {
      const manifest = JSON.stringify({
        kind: "font-bundle-set",
        version: 1,
        bundles,
      });
      await writeFile(path.join(root, "manifest.json"), manifest);
      return verifyCapturedFontBundle({
        directory: root,
        manifestSha256: createHash("sha256").update(manifest).digest("hex"),
      });
    };
    const first = await check([a, b]);
    assert.equal(first.manifest.stylesheets.length, 1);
    assert.equal(first.files.size, 2);
    for (const bytes of first.files.values())
      assert.equal(
        bytes.buffer.byteLength,
        bytes.byteLength,
        "verified files must not retain maximum-sized scratch buffers",
      );
    assert.equal((await check([a, b])).resourceDigest, first.resourceDigest);
    assert.notEqual((await check([a])).resourceDigest, first.resourceDigest);
    for (const children of [
      [a, c],
      [a, a],
      [{ ...a, directory: "../escape" }],
      [{ ...a, resourceDigest: "a".repeat(64) }],
      [],
      Array(9).fill(a),
    ])
      await assert.rejects(() => check(children));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
