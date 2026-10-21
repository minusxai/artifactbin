import assert from "node:assert/strict";
import { decode, save } from "./codec.mjs";
const fixture = `<!doctype html><html><head><meta charset="utf-8"><script data-pagegi-runtime="2"></script><script id="pagegi-state" type="application/json">{"format":2,"app":{"count":0},"comments":[]}</script></head><body><h1 data-pagegi-id="title">café &amp; 🪴</h1><script type="application/pagegi">document.querySelector('h1').textContent='rendered';</script></body></html>`;
const first = await decode(fixture);
assert.equal(
  (await decode(save(first.source, first.state))).revision,
  first.revision,
);
const next = {
  format: 2,
  app: { text: "</script><script>bad()</script> & café \u2028", count: 1 },
  comments: [],
};
const nextFile = save(first.source, next);
assert.deepEqual((await decode(nextFile)).state, next);
assert.equal((await decode(nextFile)).revision, first.revision);
assert.notEqual(
  (await decode(fixture.replace("café", "coffee"))).revision,
  first.revision,
);
for (const [name, html] of [
  [
    "ambiguous metadata",
    fixture.replace(
      "</body>",
      '<script id="pagegi-state" type="application/json">{}</script></body>',
    ),
  ],
  [
    "unmanaged early script",
    fixture.replace("<body>", "<body><script>document.body.remove()</script>"),
  ],
  ["event handler", fixture.replace("<h1 ", '<h1 onclick="alert(1)" ')],
  [
    "duplicate anchor",
    fixture.replace("</body>", '<p data-pagegi-id="title">x</p></body>'),
  ],
  [
    "external dependency",
    fixture.replace(
      "</body>",
      '<script type="application/pagegi" src="https://example.invalid/a.js"></script></body>',
    ),
  ],
  [
    "active frame",
    fixture.replace("</body>", '<iframe srcdoc="foo"></iframe></body>'),
  ],
  [
    "credential envelope",
    fixture.replace('"comments":[]', '"comments":[],"accountToken":"secret"'),
  ],
  ["duplicate attribute", fixture.replace("<h1 ", '<h1 class="a" class="b" ')],
  [
    "unknown runtime",
    fixture.replace(
      'data-pagegi-runtime="2"></script>',
      'data-pagegi-runtime="2">alert(1)</script>',
    ),
  ],
  [
    "reserved state on wrong node",
    fixture.replace("</body>", '<p id="pagegi-state">x</p></body>'),
  ],
  [
    "duplicate runtime",
    fixture.replace(
      "</head>",
      '<script data-pagegi-runtime="2"></script></head>',
    ),
  ],
  [
    "non-executable runtime",
    fixture.replace(
      'data-pagegi-runtime="2"',
      'data-pagegi-runtime="2" type="application/json"',
    ),
  ],
  [
    "runtime extra attributes",
    fixture.replace(
      'data-pagegi-runtime="2"',
      'id="oops" data-pagegi-runtime="2"',
    ),
  ],
  [
    "srcset dependency",
    fixture.replace(
      "</body>",
      '<img srcset="https://example.invalid/a.png 1x"></body>',
    ),
  ],
  [
    "SVG href dependency",
    fixture.replace(
      "</body>",
      '<svg><image href="https://example.invalid/a.png"/></svg></body>',
    ),
  ],
  [
    "SVG xlink dependency",
    fixture.replace(
      "</body>",
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="https://example.invalid/a.png"/></svg></body>',
    ),
  ],
  [
    "escaped CSS dependency",
    fixture.replace(
      "</head>",
      "<style>body{background:u\\72l(https://example.invalid/a.png)}</style></head>",
    ),
  ],
  [
    "tab script URL",
    fixture.replace(
      "</body>",
      '<a href=" &#9;java&#9;script:alert(1)">bad</a></body>',
    ),
  ],
  [
    "SVG declarative mutation",
    fixture.replace(
      "</body>",
      '<svg><set attributeName="href" to="https://example.invalid/a.png"/></svg></body>',
    ),
  ],
  [
    "SVG paint dependency",
    fixture.replace(
      "</body>",
      '<svg><path fill="url(https://example.invalid/paint.svg#x)" d="M0 0"/></svg></body>',
    ),
  ],
  [
    "escaped import",
    fixture.replace(
      "</head>",
      '<style>@im\\70ort "https://example.invalid/x";</style></head>',
    ),
  ],
  [
    "escaped image-set",
    fixture.replace(
      "</head>",
      '<style>p{background:im\\61ge-set("https://example.invalid/x" 1x)}</style></head>',
    ),
  ],
  [
    "custom property URL",
    fixture.replace(
      "</head>",
      "<style>p{--image:url(https://example.invalid/x);background:var(--image)}</style></head>",
    ),
  ],
  [
    "nested media URL",
    fixture.replace(
      "</head>",
      "<style>@media (max-width: 600px){p{background:url(https://example.invalid/x)}}</style></head>",
    ),
  ],
  [
    "escaped quoted URL",
    fixture.replace(
      "</head>",
      '<style>p{background:u\\72l("https://example.invalid/x")}</style></head>',
    ),
  ],
  [
    "dynamic src URL",
    fixture.replace(
      "</head>",
      '<style>p{background:src("https://example.invalid/x")}</style></head>',
    ),
  ],
  [
    "image URL",
    fixture.replace(
      "</head>",
      '<style>p{background:image("https://example.invalid/x")}</style></head>',
    ),
  ],
  [
    "typed attr URL",
    fixture.replace(
      "</head>",
      "<style>p{background:attr(data-image type(<url>))}</style></head>",
    ),
  ],
  ["null", fixture.replace("café", "\0")],
])
  await assert.rejects(() => decode(html), undefined, name);
assert.throws(() => save(first.source, { format: 2, app: NaN, comments: [] }));
assert.throws(() =>
  save(first.source, { format: 2, app: undefined, comments: [] }),
);
assert.equal(
  (await decode(fixture.replace("</h1>", "</h2>"))).revision,
  first.revision,
);
await decode(
  fixture.replace(
    "</head>",
    "<style>@media (max-width:600px){p{color:red}}@supports(display:grid){p{display:grid}}@keyframes fade{from{opacity:0}to{opacity:1}}</style></head>",
  ),
);
await decode(
  fixture
    .replace(
      "</head>",
      '<style>p{background:linear-gradient(red,blue);--ink:red;color:var(--ink)}p::after{content:"url(https://example.invalid/not-a-resource)"}</style></head>',
    )
    .replace(
      "</body>",
      '<svg><defs><linearGradient id="paint"/></defs><path fill="url(#paint)" d="M0 0"/></svg></body>',
    ),
);
if (process.argv[1] === new URL(import.meta.url).pathname)
  console.log("pure source behavior tests passed");
export { fixture };
