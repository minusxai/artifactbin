import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "parse5";
import { compileArchivedLocal } from "../src/migration/conversion/compiled/local.ts";
import { safeInlineModule } from "../src/migration/conversion/compiled/module-safety.ts";
test("compiled module HTML tokenizer hazards fail closed instead of absorbing the closing document", async () => {
  const input = {
    source:
      '<Helmet><Value name="text" type="string" default="safe"/></Helmet><Input value="$text"/>',
    coreUrl: "/af/v1/core.js",
  };
  for (const value of [
    "<!--<script>",
    "<!--<ScRiPt >",
    "<!--<script/",
    "</script>",
  ]) {
    const javascript = "const text=" + JSON.stringify(value) + ";";
    const result = await compileArchivedLocal(input, {
      compiler: {
        compile: async () => ({
          html: '<main data-hk="d-0"></main>',
          css: "",
          title: "Example",
          build: "fixture",
          rootAttributes: {},
          capabilities: [],
          javascript,
          declarations: [{ name: "text", type: "string", default: value }],
          modules: [],
        }),
      },
    });
    assert.equal(result.classification, "manual-blocked");
    assert.equal(result.html, null);
  }
  const valid =
    'import {client} from "@afbin/apollo";const value="\\u003c!--\\u003cscript>";';
  assert.equal(safeInlineModule(valid), true);
  const document = parse(
    '<!doctype html><html><body><script type="module">' +
      valid +
      '</script><p id="after">After</p></body></html>',
  );
  let found = false;
  const walk = (n: any) => {
    if (n.attrs?.some((a: any) => a.name === "id" && a.value === "after"))
      found = true;
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(document);
  assert.equal(found, true);
  assert.equal(safeInlineModule("const = invalid"), false);
});
