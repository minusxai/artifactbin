import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareAuthorEffects } from "../src/migration/conversion/compiled/author/effect-source.ts";
test("effects rewriting preserves text and owns direct listeners/timers without global patching", () => {
  const result = prepareAuthorEffects(`import {onMount} from 'solid-js';
const label='window.scrollY';// window.scrollY
const handler=()=>document.getElementById('out').textContent=String(window.scrollY);
document.addEventListener('click',handler,{capture:true});
setTimeout(handler,10);`);
  assert(result.source.includes("'window.scrollY'"));
  assert(result.source.includes("// window.scrollY"));
  assert(
    result.source.includes(result.lifetimeIdentifier + ".listen(document,"),
  );
  assert(result.source.includes(result.lifetimeIdentifier + ".timeout("));
  assert(result.source.includes(result.windowIdentifier + ".scrollY"));
  assert.deepEqual(result.capabilities, [
    "effects",
    "window-scalars",
    "owned-listeners",
    "owned-timers",
  ]);
});
test("effects refuse unsupported lifetimes and window escape forms before archived compilation", () => {
  for (const source of [
    `window.open('/x')`,
    `window['scrollY']`,
    `const window={};`,
    `const f=document.addEventListener;`,
    `document['addEventListener']('x',()=>{})`,
    `async function go(){}`,
    `await foo()`,
    `Promise.resolve().then(()=>{})`,
    `import {createRoot as root} from 'solid-js';root(()=>{});`,
    `import {render as r} from 'solid-js/web';r(()=>null,document.body);`,
    `document.defaultView`,
    `const {addEventListener}=window;`,
    `window.addEventListener('message',()=>{})`,
  ])
    assert.throws(() => prepareAuthorEffects(source), source);
});
test("rewrite deduplicates shared shorthand spans and chooses noncolliding private ports", () => {
  const source = `import {onCleanup} from 'solid-js';const _afLifetime0=1;const _afWindow0=2;const label='a';const data={label};window.addEventListener('resize',()=>{});`;
  const result = prepareAuthorEffects(source);
  assert.equal(result.lifetimeIdentifier, "_afLifetime1");
  assert(result.source.includes("import {onCleanup}"));
  assert(result.source.includes("const data={label}"));
  for (const value of [
    `addEventListener('click',()=>{})`,
    `window.scrollY=1`,
    `document['defaultView']`,
    `window.matchMedia('(min-width:1px)').addEventListener('change',()=>{})`,
    `foo['then'](()=>{})`,
  ])
    assert.throws(() => prepareAuthorEffects(value));
});
test("effect imports and reflection cannot escape root or listener ownership", () => {
  for (const source of [
    `import * as web from 'solid-js/web';web.render(()=>null,document.body);`,
    `import * as solid from 'solid-js';solid.createRoot(()=>{});`,
    `Reflect.get(document,'addEventListener').bind(document)('click',()=>{});`,
    `const reflect=Reflect;reflect.get(document,'addEventListener')('click',()=>{});`,
  ])
    assert.throws(() => prepareAuthorEffects(source));
});
