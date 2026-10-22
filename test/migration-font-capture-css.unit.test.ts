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
