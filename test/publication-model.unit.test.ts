import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePublication } from "../src/publication-model.ts";
const options = {
  fileId: "file",
  share: "secret",
  digest: (s: string) => "hash:" + s,
  revision: (s: string) => "rev:" + s,
};
test("publication preserves historical sources, defaults and normalized path", () => {
  const result = preparePublication(
    null,
    "actor",
    {
      requestId: "r",
      source: "new",
      sources: { "rev:old": "old" },
      path: "Folder/Page.html",
    },
    options,
  );
  assert.deepEqual(result.file?.sources, {
    "rev:old": "old",
    "rev:new": "new",
  });
  assert.equal(result.file?.path, "/Folder/Page.html");
  assert.equal(result.file?.access?.visibility, "private");
  assert.equal(result.file?.shareHash, "hash:secret");
});
test("replay preserves original receipt and refuses changed source", () => {
  const first = preparePublication(
    null,
    "actor",
    { requestId: "r", source: "new" },
    options,
  );
  assert.deepEqual(
    preparePublication(
      first.publication,
      "actor",
      { requestId: "r", source: "new", path: "bad?" },
      options,
    ),
    { publication: first.publication, file: null, created: false },
  );
  assert.throws(
    () =>
      preparePublication(
        first.publication,
        "actor",
        { requestId: "r", source: "changed" },
        options,
      ),
    /Publish request changed/,
  );
});
test("publication rejects invalid authorization, source history and policy", () => {
  for (const [actor, request] of [
    ["", { requestId: "r", source: "x" }],
    ["actor", { requestId: "r", source: "x", sources: { bad: "old" } }],
    ["actor", { requestId: "r", source: "x", visibility: "bad" }],
    ["actor", { requestId: "r", source: "x", linkRole: "bad" }],
  ] as const)
    assert.throws(() =>
      preparePublication(null, actor, request as any, options),
    );
});

test('publication applies the UTF8 byte budget to current and historical source', () => {
  const source = '☃'.repeat(2_000_000);
  const compact = { ...options, digest: () => 'digest', revision: () => 'revision' };
  assert.ok(preparePublication(null, 'actor', { requestId: 'utf8', source }, compact).file);
  assert.throws(() => preparePublication(null, 'actor', { requestId: 'utf8', source: source + 'x' }, compact), /UTF-8 byte limit/);
  assert.throws(() => preparePublication(null, 'actor', { requestId: 'utf8', source: 'ok', sources: { old: source + 'x' } }, compact), /UTF-8 byte limit/);
});
