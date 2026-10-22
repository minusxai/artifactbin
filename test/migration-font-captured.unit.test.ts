import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { captureFontJob } from "../src/migration/conversion/compiled/fonts/capture.ts";
import { writeCapturedFontJob } from "../src/migration/conversion/compiled/fonts/capture-write.ts";
import { prepareArchivedFontResources } from "../src/migration/conversion/compiled/fonts/captured.ts";
import { inlinePinnedFontImports } from "../src/migration/conversion/compiled/fonts/inline.ts";
test("converter replays an exact verified capture without network or family-only substitution", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "font-captured-"));
  try {
    const request =
        "https://fonts.googleapis.com/css2?family=Example:wght@400&display=swap",
      css = `@font-face{font-family:'Example';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/example/v1/a.woff2) format('woff2');unicode-range:U+0000-00FF}`,
      bytes = Buffer.alloc(52);
    bytes.write("wOF2");
    bytes.writeUInt32BE(0x10000, 4);
    bytes.writeUInt32BE(52, 8);
    bytes.writeUInt16BE(1, 12);
    bytes.writeUInt32BE(128, 16);
    bytes.writeUInt32BE(2, 20);
    bytes[49] = 100;
    const inspection = {
        families: ["Example"],
        axes: [],
        weight: 400,
        style: "normal" as const,
      },
      job = await captureFontJob([request], {
        fetch: async (_u, kind) =>
          kind === "stylesheet" ? Buffer.from(css) : bytes,
        inspect: async () => inspection,
        now: () => 0,
        schedule: () => () => {},
      }),
      directory = path.join(parent, "bundle"),
      receipt = await writeCapturedFontJob(job, directory);
    let local = 0,
      decoded = 0;
    const prepared = await prepareArchivedFontResources(
      "unused",
      { directory, ...receipt },
      {
        local: async () => {
          local++;
          throw Error("unresolved font");
        },
        inspect: async () => {
          decoded++;
          return inspection;
        },
      },
    );
    const original = `@import '${request}';p{color:red}`,
      first = await inlinePinnedFontImports(original, prepared.resolve),
      second = await inlinePinnedFontImports(original, prepared.resolve);
    assert.equal(first.css, second.css);
    assert(!first.css.includes("https:"));
    assert(first.css.includes("data:font/woff2"));
    assert.equal(local, 0);
    assert.equal(decoded, 1);
    assert.match(prepared.resourceDigest!, /^[a-f0-9]{64}$/);
    await assert.rejects(() =>
      inlinePinnedFontImports(
        original.replace("wght@400", "wght@401"),
        prepared.resolve,
      ),
    );
    assert.equal(local, 1);
    const mismatched = await prepareArchivedFontResources(
      "unused",
      { directory, ...receipt },
      {
        local: async () => [],
        inspect: async () => ({ ...inspection, families: ["Different"] }),
      },
    );
    await assert.rejects(() =>
      inlinePinnedFontImports(original, mismatched.resolve),
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
