// @requires archived-compiler
import test from "node:test";
import assert from "node:assert/strict";
import { compileArchivedAuthor } from "../src/migration/conversion/compiled/local.ts";
const legacyRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test("historical authored layout retains declared unavailable writes without registering a backend", { skip: !legacyRoot }, async () => {
  const source = '<Helmet><Import name="items" src="ref:Abcd12"/><Query name="rows">{`select title from items.rows`}</Query><Mutation name="save">{`insert into items.rows(title) values($title)`}</Mutation><script type="module">{`import {mutation} from "page";export function Editor(){const save=mutation("$save");return <section><p>Saved editor layout</p><button onClick={()=>save({title:"one"})}>Save</button></section>}`}</script></Helmet><h1>Saved report</h1><Editor id="editor"/>';
  const result = await compileArchivedAuthor({ source, coreUrl: "/af/v1/core.js", datasetUnavailable: { reason: "historical-binding-unavailable" } }, { legacyRoot: legacyRoot!, sourceAdmission: "offline-prototype" });
  assert.equal(result.classification, "renderable", JSON.stringify(result.issues));
  assert.match(result.html!, /Saved report/);
  assert.match(result.html!, /Historical data is unavailable/);
  assert.doesNotMatch(result.html!, /rel="af-backend"/);
  assert.equal(result.provenance?.mode, "historical-data-unavailable");
});
