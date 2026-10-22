import { test } from "node:test";
import assert from "node:assert/strict";
import { ownedComponentInitializerModule } from "../src/migration/conversion/compiled/author/owned-components-module.ts";
import { prepareOwnedAuthorComponents } from "../src/migration/conversion/compiled/author/effect-source.ts";
test("owned compiled initializer keeps shared statements inside one call and pins exact named exports", () => {
  const plan = prepareOwnedAuthorComponents(
    "export function First(){return <p/>;}export const Second=()=> <p/>;",
  );
  const result = ownedComponentInitializerModule(
    `import {createSignal} from 'solid-js';const state=createSignal(0);function A(){}const B=()=>{};export {A as First,B as Second};`,
    plan,
  );
  assert(
    result.indexOf("export function initialize") <
      result.indexOf("const state="),
  );
  assert(result.includes('"First":A'));
  assert(result.includes('"Second":B'));
  for (const compiled of [
    "export function First(){}",
    "function A(){};export {A as First,A as Third};",
    "export default function First(){}",
    'export {A as First} from "x";',
  ])
    assert.throws(() => ownedComponentInitializerModule(compiled, plan));
});
