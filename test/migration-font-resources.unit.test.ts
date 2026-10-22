import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parsePinnedFontRequest,
  inlinePinnedFontImports,
} from "../src/migration/conversion/compiled/fonts/inline.ts";
test("font requests retain exact CSS2 axes and reject ambient fetch or ambiguous query semantics", () => {
  assert.deepEqual(
    parsePinnedFontRequest(
      "https://fonts.googleapis.com/css2?family=Example+Font:opsz,wght@12..96,200..800&display=swap",
    ),
    {
      display: "swap",
      families: [
        {
          family: "Example Font",
          axes: [
            { tag: "opsz", min: 12, max: 96 },
            { tag: "wght", min: 200, max: 800 },
          ],
        },
      ],
    },
  );
  for (const url of [
    "http://fonts.googleapis.com/css2?family=A",
    "https://fonts.googleapis.com.evil.test/css2?family=A",
    "https://name@fonts.googleapis.com/css2?family=A",
    "https://fonts.googleapis.com:444/css2?family=A",
    "https://fonts.googleapis.com/css2?family=A#x",
    "https://fonts.googleapis.com/css2?family=A&text=secret",
    "https://fonts.googleapis.com/css2?family=A&display=swap&display=block",
    "https://fonts.googleapis.com/css2?family=A:wght@900..100",
    "https://fonts.googleapis.com/css2?family=A:wght,opsz@400,12",
    "https://fonts.googleapis.com/css?family=A:400,700",
  ])
    assert.throws(() => parsePinnedFontRequest(url));
});
test("only exact pinned font import rules are replaced and face bytes and unicode semantics are retained", async () => {
  const bytes = Buffer.from("wOF2synthetic-fixture"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const result = await inlinePinnedFontImports(
    `@import url('https://fonts.googleapis.com/css2?family=Example+Font:wght@200..800&display=swap');p{color:red}`,
    async (request) => [
      {
        family: "Example Font",
        axes: [{ tag: "wght", min: 200, max: 800 }],
        weight: [200, 800],
        style: "normal",
        unicodeRange: "U+0000-00FF",
        bytes,
        sha256,
      },
    ],
  );
  assert(result.css.includes("font-weight:200 800"));
  assert(result.css.includes("font-display:swap"));
  assert(result.css.includes("unicode-range:U+0000-00FF"));
  assert(result.css.includes(bytes.toString("base64")));
  assert(result.css.endsWith("p{color:red}"));
  assert.equal(result.receipts[0]?.faces[0]?.sha256, sha256);
  for (const css of [
    `@import 'https://example.invalid/font.css';`,
    `@import url('https://fonts.googleapis.com/css2?family=Example+Font') screen;`,
  ])
    await assert.rejects(() => inlinePinnedFontImports(css, async () => []));
  await assert.rejects(() =>
    inlinePinnedFontImports(
      `@import 'https://fonts.googleapis.com/css2?family=Example+Font:wght@200..800';`,
      async () => [
        {
          family: "Example Font",
          axes: [{ tag: "wght", min: 100, max: 900 }],
          weight: [100, 900],
          style: "normal",
          unicodeRange: "U+0000-00FF",
          bytes,
          sha256,
        },
      ],
    ),
  );
});
test("font admission refuses tokenizer tricks, import qualifiers and unproven descriptor or resource changes", async () => {
  for (const value of [
    "https://fonts.googleapis.com/x/../css2?family=A",
    "https://fonts.googleapis.com/css2?family=A&%74ext=x",
    "https://fonts.googleapis.com/css2?family=A&family=a",
    "https://fonts.googleapis.com/css2?family=A:wght@400;400",
    "https://fonts.googleapis.com/css2?family=A:wght,wght@400,400",
    "https://fonts.googleapis.com/css2?family=A%0A",
    "https://fonts.googleapis.com/css2?family=A\\B",
  ])
    assert.throws(() => parsePinnedFontRequest(value));
  const url = "https://fonts.googleapis.com/css2?family=Example:wght@400";
  for (const suffix of [
    "layer(foo)",
    "supports(display:grid)",
    "screen",
    "layer",
  ])
    await assert.rejects(() =>
      inlinePinnedFontImports(
        `@import url('${url}') ${suffix};`,
        async () => [],
      ),
    );
  const bytes = Buffer.from("wOF2fixture"),
    face = {
      family: "Example",
      axes: [{ tag: "wght", min: 400, max: 400 }],
      weight: [400, 400] as const,
      style: "normal" as const,
      unicodeRange: "U+0000-00FF",
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  for (const override of [
    { style: "italic" as const },
    { weight: [100, 900] as const },
    { sha256: "0".repeat(64) },
    { unicodeRange: "U+00FF;src:url(https://example.invalid)" },
    { axes: [...face.axes, { tag: "opsz", min: 12, max: 96 }] },
    { bytes: Buffer.alloc(2_000_001) },
  ])
    await assert.rejects(() =>
      inlinePinnedFontImports(`@import '${url}';`, async () => [
        { ...face, ...override },
      ]),
    );
  await assert.rejects(() =>
    inlinePinnedFontImports(`@import '${url}';`, async () =>
      Array.from({ length: 65 }, () => face),
    ),
  );
});
