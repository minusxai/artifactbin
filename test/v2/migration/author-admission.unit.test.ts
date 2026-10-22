import { test } from "node:test";
import assert from "node:assert/strict";
import { admitAuthorSource } from "../../../src/migration/conversion/compiled/author/admission.ts";
test("author admission accepts supported unchanged Solid sources", () => {
  admitAuthorSource(
    `import {signal,query} from 'page';import {For,createSignal} from 'solid-js';export function Counter(){const [n,set]=signal('$count');const rows=query('$rows');return <button onClick={()=>set(v=>v+1)}>{n()}<For each={rows()}>{row=><b>{row.title}</b>}</For></button>}`,
  );
});
test("unsupported network, upload and package capabilities fail admission", () => {
  for (const source of [
    `import {upload} from 'page';`,
    `import x from 'three';`,
    `fetch('/x')`,
    `window.fetch('/x')`,
    `import('solid-js')`,
    `const method='fetch';globalThis[method]('/x')`,
  ])
    assert.throws(() => admitAuthorSource(source));
});

test("author admission accepts only named page mutation imports without granting ambient transport", () => {
  admitAuthorSource(
    `import {mutation as bind} from 'page';const save=bind('$save');export function Save(){return <button onClick={()=>save({amount:2})}>Save</button>}`,
  );
  for (const source of [
    `import * as page from 'page'`,
    `import mutation from 'page'`,
    `import {mutate} from 'page'`,
    `import {mutation} from 'page';fetch('/write')`,
  ])
    assert.throws(() => admitAuthorSource(source));
});
