import test from "node:test";
import assert from "node:assert/strict";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import { admitLocalComponent } from "../src/migration/conversion/compiled/component-admission.ts";
const node = (source: string) =>
  Parser.extend(jsx()).parseExpressionAt(source, 0, { ecmaVersion: "latest" });
const context = { ancestors: [] };
test("component families return plans and unresolved symbols without traversal state", () => {
  const slider = admitLocalComponent(
    node('<Slider value="$n" min={-2} max={2}/>'),
    context,
  )!;
  assert.deepEqual(slider.references, ["n"]);
  assert.deepEqual(slider.scalarBindings, ["n"]);
  assert.equal(slider.scalarControls[0]?.valueType, "number");
  const select = admitLocalComponent(
    node('<Select value="$selected" options="$choices"/>'),
    context,
  )!;
  assert.deepEqual(select.references, ["selected", "choices"]);
  assert.deepEqual(select.scalarBindings, ["selected"]);
  const table = admitLocalComponent(
    node(
      '<DataTable id="table" data="$rows" rowKey="key"><Column col="label"><span id="label">Text</span></Column></DataTable>',
    ),
    context,
  )!;
  assert.deepEqual(table.descendantScope, {
    kind: "row",
    table: "rows",
    key: "key",
  });
  assert.deepEqual(table.references, ["rows"]);
  assert.equal(admitLocalComponent(node("<div/>"), context), null);
});
test("presentation lifecycle and transparent identity hosts remain explicit", () => {
  const provider = admitLocalComponent(
    node('<TooltipProvider id="provider"/>'),
    context,
  )!;
  assert.deepEqual(provider.presentationIdentityHosts, [
    { tag: "TooltipProvider", id: "provider" },
  ]);
  assert.equal(provider.identityLifecycle?.identity, "transparent");
  const content = admitLocalComponent(node("<TooltipContent/>"), {
    ancestors: ["Tooltip"],
  })!;
  assert.equal(content.identityLifecycle?.identity, "direct");
  assert.throws(() => admitLocalComponent(node("<TooltipContent/>"), context));
});
test("family admission refuses malformed attrs, misplaced columns and nested row scopes", () => {
  for (const source of [
    '<Slider value="$n" value="$m"/>',
    "<Select {...props}/>",
    "<Slider min={call()}/>",
    '<DataTable data="$rows"><div/></DataTable>',
    '<DataTable data="$rows"><Column col="x" hasContent/></DataTable>',
  ])
    assert.throws(() => admitLocalComponent(node(source), context), source);
  assert.throws(() => admitLocalComponent(node('<Column col="x"/>'), context));
  assert.throws(() =>
    admitLocalComponent(
      node(
        '<DataTable id="table" data="$rows" rowKey="key"><Column col="x"/></DataTable>',
      ),
      { ancestors: [], rowTable: "outer" },
    ),
  );
});

test("custom cell identities require durable owner and row keys without mutating source", () => {
  const source =
    '<DataTable id="table" data="$rows" rowKey="key"><Column col="label"><span id="label">Text</span></Column></DataTable>';
  const tree = node(source);
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      for (const entry of Object.values(value)) freeze(entry);
      Object.freeze(value);
    }
  };
  freeze(tree);
  const before = JSON.stringify(tree);
  assert.ok(admitLocalComponent(tree, context));
  assert.equal(JSON.stringify(tree), before);
  for (const invalid of [
    source.replace(' id="table"', ""),
    source.replace(' rowKey="key"', ""),
  ])
    assert.throws(() => admitLocalComponent(node(invalid), context));
});

test("Dialog mutation forms retain registered names and scalar binding facts and refuse nested forms",()=>{
 const c={ancestors:["Dialog"]};
 const form=admitLocalComponent(node('<DialogContent run="$save" args={{title:"$title",owner:"$_me.id"}}><input value="$title" required={true}/><button type="submit">Save</button></DialogContent>'),c)!;
 assert.equal(form.dialogMutationForm?.name,"save");assert.deepEqual(form.references,["title"]);assert.equal(form.dialogMutationForm?.requiresViewer,true);
 for(const source of ['<DialogContent args={{title:"$title"}}/>','<DialogContent run="$save"><form/></DialogContent>','<DialogContent run="$save"><Custom/></DialogContent>','<DialogContent run="$save" args={{title:"$_row.title"}}/>'])assert.throws(()=>admitLocalComponent(node(source),c));
 assert.throws(()=>admitLocalComponent(node('<DialogContent run="$save"/>'),{ancestors:["Dialog","form"]}));
});
