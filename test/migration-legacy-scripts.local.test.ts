// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArchivedManagedFrames } from "../src/migration/conversion/compiled/legacy-scripts.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
const managedFrameFixture =
  '<Helmet><title>Frame migration</title></Helmet><p id="outside" class="label">Outside</p><Iframe id="frame"><style>{`body { color: rgb(10, 20, 30); } .label { font-weight: 700; }`}</style><button id="trigger">Change</button><p id="inside" class="label">Inside</p><script id="frame-script">{`document.querySelector("button").addEventListener("click", () => { document.querySelector(".label").textContent = "Changed"; });`}</script></Iframe>';
test(
  "exact original codemod keeps frame/content IDs and scopes its script and styles",
  { skip: !root },
  async () => {
    const result = await normalizeArchivedManagedFrames(
      managedFrameFixture,
      root!,
    );
    assert.ok(result);
    assert.doesNotMatch(result.source, /<Iframe\b/);
    for (const id of ["outside", "frame", "trigger", "inside"])
      assert.equal(result.source.split('id="' + id + '"').length, 2);
    assert.match(
      result.source,
      /document\.getElementById\(['"]frame['"]\)\.querySelector/,
    );
    assert.match(result.source, /#frame/);
    assert.equal(
      await normalizeArchivedManagedFrames(result.source, root!),
      null,
    );
  },
);
test(
  "unresolved frame scripts and duplicate content IDs are refused without partial promotion",
  { skip: !root },
  async () => {
    for (const source of [
      '<Iframe id="frame"><script src="https://example.invalid/script.js"/></Iframe>',
      '<p id="same"/><Iframe id="frame"><p id="same"/><script>{`document.querySelector("p")`}</script></Iframe>',
    ])
      assert.equal(await normalizeArchivedManagedFrames(source, root!), null);
  },
);

test(
  "generated frame identities do not reuse any existing identifier",
  { skip: !root },
  async () => {
    const result = await normalizeArchivedManagedFrames(
      '<p id="migrated-frame-1"/><Iframe><p id="child"/></Iframe>',
      root!,
    );
    assert.ok(result);
    assert.equal(result.source.split('id="migrated-frame-1"').length, 2);
    assert.match(result.source, /id="migrated-frame-2"/);
    assert.match(result.source, /id="child"/);
  },
);
