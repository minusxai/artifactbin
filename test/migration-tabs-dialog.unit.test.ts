import { test } from "node:test";
import assert from "node:assert/strict";
import { admitPresentationKit } from "../src/migration/conversion/compiled/presentation-kit.ts";
import { admitLocalSource } from "../src/migration/conversion/compiled/source-admission.ts";

test("tabs preserve hidden compiled identities and require their actual root context", () => {
  assert.equal(
    admitPresentationKit("Tabs", {
      defaultValue: "overview",
      orientation: "horizontal",
      dir: "ltr",
    }).identity,
    "direct",
  );
  assert.equal(
    admitPresentationKit("TabsList", { variant: "line" }, ["Tabs"]).identity,
    "direct",
  );
  for (const tag of ["TabsTrigger", "TabsContent"]) {
    const result = admitPresentationKit(tag, { value: "overview" }, ["Tabs"]);
    assert.equal(result.identity, "direct");
    assert.equal(result.conditionalChildren, false);
    assert.throws(
      () => admitPresentationKit(tag, { value: "overview" }),
      /context/,
    );
    assert.throws(() => admitPresentationKit(tag, {}, ["Tabs"]), /value/);
    assert.throws(() =>
      admitPresentationKit(tag, { value: "$selected" }, ["Tabs"]),
    );
  }
  for (const attrs of [
    { dir: "rtl" },
    { onValueChange: "handler" },
    { value: "$selected" },
    { orientation: "diagonal" },
  ])
    assert.throws(() => admitPresentationKit("Tabs", attrs));
  assert.throws(() =>
    admitPresentationKit("TabsList", { loop: false }, ["Tabs"]),
  );
  assert.throws(() =>
    admitPresentationKit("TabsList", { variant: "unknown" }, ["Tabs"]),
  );
});

test("only Dialog open may name a typed boolean declaration without evaluating it", () => {
  assert.deepEqual(
    admitPresentationKit("Dialog", { open: "$settingsOpen" }).scalarBinding,
    { tag: "Dialog", binding: "settingsOpen", valueType: "boolean" },
  );
  assert.equal(
    admitPresentationKit("Dialog", { open: false }).scalarBinding,
    undefined,
  );
  for (const open of [
    "$constructor",
    "$_me",
    "$query.open",
    "$open()",
    "true",
    {},
    () => true,
  ])
    assert.throws(() => admitPresentationKit("Dialog", { open }));
  assert.throws(() =>
    admitPresentationKit("Dialog", { defaultOpen: "$settingsOpen" }),
  );
  assert.throws(() =>
    admitPresentationKit("DialogContent", { run: "$save" }, ["Dialog"]),
  );
});

test("source resolves Dialog bindings against boolean Values and reconciles the manifest", () => {
  const source = (declarations: string, open = '"$settingsOpen"') => ({
    source: `<Helmet>${declarations}</Helmet><Dialog id="settings" open=${open}><DialogTrigger id="open">Open</DialogTrigger><DialogContent id="content"><DialogClose id="close">Close</DialogClose></DialogContent></Dialog>`,
    coreUrl: "/af/v1/core.js",
  });
  const result = admitLocalSource(
    source('<Value name="settingsOpen" type="boolean" default={false}/>'),
  );
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(result.plan.manifest.declarations, [
      { name: "settingsOpen", type: "boolean", default: false },
    ]);
  for (const declaration of [
    "",
    '<Value name="settingsOpen" type="string" default="false"/>',
    '<Value name="settingsOpen" type="table" value={[]}/>',
    '<Query name="settingsOpen">{`select 1 as open`}</Query>',
  ])
    assert.equal(admitLocalSource(source(declaration)).ok, false);
  assert.equal(
    admitLocalSource(
      source(
        '<Value name="settingsOpen" type="boolean" default={false}/>',
        "{$settingsOpen}",
      ),
    ).ok,
    false,
  );
});
