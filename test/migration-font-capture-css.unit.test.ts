import { test } from "node:test";
import assert from "node:assert/strict";
import { admitCapturedFontCss } from "../src/migration/conversion/compiled/fonts/capture-css.ts";
const url =
  "https://fonts.googleapis.com/css2?family=Example:wght@200..800&display=swap";
const css = `/* latin */@font-face{font-family:'Example';font-style:normal;font-weight:200 800;font-display:swap;src:url(https://fonts.gstatic.com/s/example/v1/a.woff2) format('woff2');unicode-range:U+0000-00FF}`;
test("captured CSS binds only exact requested family axes and explicit Unicode subsets", () => {
  const faces = admitCapturedFontCss(css, url);
  assert.equal(faces.length, 1);
  assert.deepEqual(faces[0]?.weight, [200, 800]);
  assert.equal(faces[0]?.unicodeRange, "U+0000-00FF");
  for (const changed of [
    css + "p{color:red}",
    css.replace("font-style:normal", "font-style:italic"),
    css.replace("200 800", "100 900"),
    css.replace("font-display:swap", "font-display:block"),
    css.replace("U+0000-00FF", "U+110000"),
    css.replace(
      "https://fonts.gstatic.com/s/example/v1/a.woff2",
      "https://example.invalid/a.woff2",
    ),
    css.replace("format('woff2')", "format('woff')"),
    css.replace("font-style:normal", "font-style:normal!important"),
    css.replace("font-weight:", "font-style:normal;font-weight:"),
  ])
    assert.throws(() => admitCapturedFontCss(changed, url));
});
test("provider omissions preserve returned face descriptors without manufacturing requested styles", async () => {
  const { capturedFontOmissions } = await import(
    "../src/migration/conversion/compiled/fonts/capture-css.ts"
  );
  const { inlinePinnedFontImports } = await import(
    "../src/migration/conversion/compiled/fonts/inline.ts"
  );
  const { createHash } = await import("node:crypto");
  const request =
    "https://fonts.googleapis.com/css2?family=Example:ital,wght@0,400;1,400&display=swap";
  const provider = css.replace("200 800", "400");
  const descriptors = admitCapturedFontCss(provider, request);
  const omissions = capturedFontOmissions(descriptors, request);
  assert.deepEqual(omissions, [
    {
      family: "Example",
      axes: [
        { tag: "ital", min: 1, max: 1 },
        { tag: "wght", min: 400, max: 400 },
      ],
    },
  ]);
  const bytes = Buffer.from("wOF2synthetic");
  const faces = descriptors.map((face) => ({
    ...face,
    axes: [
      { tag: "ital", min: 0, max: 0 },
      { tag: "wght", min: 400, max: 400 },
    ],
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
  const result = await inlinePinnedFontImports(
    `@import '${request}';`,
    async () => ({ faces, omittedRequests: omissions }),
  );
  assert.match(result.css, /font-style:normal/);
  assert.doesNotMatch(result.css, /font-style:italic/);
  assert.match(result.css, /font-weight:400;/);
  assert.match(result.css, /font-display:swap/);
  assert.match(result.css, /unicode-range:U\+0000-00FF/);
  assert.deepEqual(result.receipts[0]?.omittedRequests, omissions);
  for (const omittedRequests of [
    [],
    [...omissions, ...omissions],
    [{ family: "Other", axes: omissions[0]!.axes }],
    [
      {
        family: "Example",
        axes: [
          { tag: "ital", min: 0, max: 0 },
          { tag: "wght", min: 400, max: 400 },
        ],
      },
    ],
  ])
    await assert.rejects(() =>
      inlinePinnedFontImports(`@import '${request}';`, async () => ({
        faces,
        omittedRequests,
      })),
    );
  assert.throws(() =>
    admitCapturedFontCss(provider, request + "&family=Missing"),
  );
});
