import test from "node:test";
import assert from "node:assert/strict";
import { extractLegacyImports } from "../src/migration/conversion/imports.ts";
test("extracts literal Import aliases and exact legacy IDs without inventing a version", () => {
  assert.deepEqual(
    extractLegacyImports(
      '<Helmet><Import name="first" src="ref:Abcd12"/><Import name={"second"} src={"ref:Abcd12345678"}/></Helmet><p>Content</p>',
    ),
    {
      imports: [
        { name: "first", legacyRef: "ref:Abcd12", datasetLegacyId: "Abcd12" },
        {
          name: "second",
          legacyRef: "ref:Abcd12345678",
          datasetLegacyId: "Abcd12345678",
        },
      ],
      issues: [],
    },
  );
});
test("invalid or dynamic Import declarations fail the entire dependency extraction", () => {
  for (const tail of [
    '<Import name="bad" src={globalThis.ref}/>',
    '<Import name="bad" src="https://example.invalid/data"/>',
    '<Import name="first" src="ref:Other1"/>',
    '<Import name="bad" src="ref:Other1" unknown="x"/>',
    '<Import name="bad" src="ref:Other1">content</Import>',
  ]) {
    const result = extractLegacyImports(
      '<Helmet><Import name="first" src="ref:Abcd12"/>' + tail + "</Helmet>",
    );
    assert.equal(result.imports.length, 0);
    assert.ok(result.issues.length);
  }
  assert.ok(
    extractLegacyImports('<Import name="first" src="ref:Abcd12"/>').issues
      .length,
  );
  assert.ok(
    extractLegacyImports("<p>kept</p></>;globalThis.x=1;//").issues.length,
  );
  assert.deepEqual(extractLegacyImports("<p>No imports</p>"), {
    imports: [],
    issues: [],
  });
});
