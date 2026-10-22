// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
import { readLegacySourceQuerySites } from "../src/migration/conversion/compiled/source-query-source.ts";
const root = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
const source =
  '<Helmet><Value name="choice" type="string" default="one"/><Query name="rows" source="ref:Abcd12">{`select $choice::text as label`}</Query></Helmet><p id="label">{$rows.label}</p>';
const site = readLegacySourceQuerySites(source)[0]!;
const proof = {
  name: site.name,
  sourceRef: site.sourceRef,
  sqlSha256: site.sqlSha256,
  backendNamespace: "legacyData" as const,
  backendHref: "/af/v1/ids/Bk1234",
  params: { choice: "string" as const },
  columns: [{ name: "label", type: "string" as const }],
};
test(
  "exact source proof enables only named remote query compilation, never a missing or mismatched dataset",
  { skip: !root },
  async () => {
    const input = { source, coreUrl: "/af/v1/core.js", sourceQueries: [proof] };
    const result = await compileArchivedLocal(input, {
      legacyRoot: root!,
      sourceAdmission: "offline-prototype",
    });
    assert.equal(
      result.classification,
      "functional",
      JSON.stringify(result.issues),
    );
    assert.match(result.html!, /rel="af-backend" href="\/af\/v1\/ids\/Bk1234"/);
    for (const sourceQueries of [
      [],
      [{ ...proof, sqlSha256: "b".repeat(64) }],
      [{ ...proof, sourceRef: "ref:Other1" }],
    ])
      assert.equal(
        (
          await compileArchivedLocal(
            { ...input, sourceQueries },
            { legacyRoot: root!, sourceAdmission: "offline-prototype" },
          )
        ).classification,
        "manual-blocked",
      );
    assert.equal(
      (
        await compileArchivedLocal(
          {
            ...input,
            source: source.replace(
              "</Helmet>",
              '<Query name="local">{`select 1 as n`}</Query></Helmet>',
            ),
          },
          { legacyRoot: root!, sourceAdmission: "offline-prototype" },
        )
      ).classification,
      "manual-blocked",
    );
  },
);
test("source discovery hashes only actual static query declarations", () => {
  assert.equal(site.sql, "select $choice::text as label");
  assert.equal(
    readLegacySourceQuerySites("<p>Text source=&quot;ref:Abcd12&quot;</p>")
      .length,
    0,
  );
  assert.throws(() =>
    readLegacySourceQuerySites(
      '<Helmet><Query name="rows" source="ref:Abcd12">{`select ${1}`}</Query></Helmet>',
    ),
  );
});
