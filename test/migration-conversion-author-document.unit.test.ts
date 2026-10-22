import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareAuthorDocument,
  rewriteCompiledMounts,
} from "../src/migration/conversion/compiled/author-document.ts";
test("whole author document extraction keeps fallback/layout and never evaluates authored code", () => {
  const source =
    '<Helmet><style>{`.example{color:red}`}</style><script>{`import {createSignal} from "solid-js";export function Example(){return <button>Go</button>}`}</script></Helmet><main id="layout"><Example id="mount"><p id="fallback">Loading</p></Example></main>';
  const plan = prepareAuthorDocument(source);
  assert.equal(plan.author.mounts[0]?.identity, "mount");
  assert.equal(plan.author.exports[0], "Example");
  assert.ok(!plan.source.includes("<script>"));
  assert.match(plan.source, /<p id="fallback">Loading<\/p>/);
  assert.throws(
    () => prepareAuthorDocument(source.replace('id="mount"', "")),
    /identity/,
  );
  assert.throws(
    () => prepareAuthorDocument(source.replace("createSignal", "fetch")),
    /Unsupported/,
  );
  assert.throws(() => prepareAuthorDocument(source + " </>;sideEffect();//"));
});
test("mount attribute rewrite changes syntax attributes without changing authored text literals", () => {
  const source =
    'const Document=()=> <div data-mx-mount="Example" data-mx-props="{}" data-mx-bind="{}">data-mx-mount</div>;';
  const result = rewriteCompiledMounts(source);
  assert.match(result, /data-migration-author-component="Example"/);
  assert.match(result, />data-mx-mount<\/div>/);
});

test("effect-only scripts have an explicit lifetime mode and unknown async or window paths refuse", () => {
  const document = prepareAuthorDocument(
    `<Helmet><script>{\`document.addEventListener('click',()=>document.getElementById('out').textContent='clicked');\`}</script></Helmet><p id="out">Ready</p>`,
  );
  assert.equal(document.author.mode, "effects");
  assert.deepEqual(document.author.mounts, []);
  assert.deepEqual(document.author.exports, []);
  assert(!document.source.includes("<script>"));
  assert.throws(() =>
    prepareAuthorDocument(
      `<Helmet><script>{\`window.open('/x')\`}</script></Helmet>`,
    ),
  );
});
