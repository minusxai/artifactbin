import { test } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "acorn";
import { localBootSource } from "../../../src/migration/conversion/compiled/local-boot.ts";
import { validCompiledPersonBindings } from "../../../src/migration/conversion/compiled/person-binding.ts";
test("person routing rejects ambiguous or author-selected authority fields", () => {
  const valid = { valueName: "owner", backendNamespace: "legacyData" };
  assert.equal(validCompiledPersonBindings([valid]), true);
  for (const value of [
    [valid, valid],
    [{ ...valid, source: "ref:Dataset001" }],
    [{ ...valid, valueName: "__proto__" }],
    [{ ...valid, backendNamespace: "arbitrary" }],
  ])
    assert.equal(validCompiledPersonBindings(value), false);
});
test("compiled person boot watches only fixed selected-person requests and fills the kit people port", () => {
  const source = localBootSource(
    [{ name: "owner", type: "user", default: null }],
    undefined,
    undefined,
    undefined,
    false,
    [],
    [],
    undefined,
    undefined,
    [{ valueName: "owner", backendNamespace: "legacyData" }],
  );
  assert.doesNotThrow(() =>
    Parser.parse(source, { ecmaVersion: "latest", sourceType: "module" }),
  );
  assert.match(source, /query SelectedPerson/);
  assert.match(source, /people:people/);
  assert.match(source, /peopleAdapter.update\(values\(\)\)/);
  assert.doesNotMatch(source, /people:\(\)=>\(\{\}\)/);
});
