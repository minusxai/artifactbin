import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareOwnedAuthorComponents } from "../src/migration/conversion/compiled/author/effect-source.ts";
test("owned components retain one module body and rewrite viewport listeners and delegated callbacks", () => {
  const source = `import {createSignal} from 'solid-js';const [shared,setShared]=createSignal(0);export function Counter(){const update=()=>setShared(window.scrollY);window.addEventListener('scroll',update);return <button onClick={()=>setShared(window.innerHeight)}>{shared()}</button>;}export const Other=()=> <p>{shared()}</p>;`;
  const plan = prepareOwnedAuthorComponents(source);
  assert.deepEqual(plan.exports, ["Counter", "Other"]);
  assert.equal(plan.source.match(/createSignal\(0\)/g)?.length, 1);
  assert(plan.source.includes(plan.windowIdentifier + ".addEventListener"));
  assert(plan.source.includes(plan.lifetimeIdentifier + ".callback("));
});
test("owned components refuse timers, indirect roots, unknown export identity and untracked handler forms", () => {
  for (const source of [
    `export function A(){setTimeout(()=>{},0);return <p/>;}`,
    `import * as web from 'solid-js/web';export function A(){web.render(()=> <p/>,document.body);}`,
    `export default function A(){return <p/>;}`,
    `const A=()=> <p/>;export {A};`,
    `export const A=3;`,
    `export function A(){return <button {...props}/>;}`,
    `export function A(){return <button onClick={[handler,3]}/>;}`,
    `export function A(){document.onclick=()=>{};return <p/>;}`,
    `export function A(){return <button on:click={[handler,3]}/>;}`,
    `import {runWithOwner} from "solid-js";export function A(){return <p/>;}`,
  ])
    assert.throws(() => prepareOwnedAuthorComponents(source));
});
