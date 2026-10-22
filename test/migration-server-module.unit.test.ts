import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { compileLegacyServerModule } from "../src/migration/server-module.ts";
const declarations = {
  values: ["region"],
  queries: ["rows"],
  mutations: ["rename"],
};
test("offline server compilation never executes authored module code", async () => {
  const compiled = await compileLegacyServerModule(
    "throw Error('must not execute during compilation');export default async function(input){return input}",
    declarations,
  );
  assert.match(compiled.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(typeof compiled.factorySource, "string");
  assert.throws(
    () => runInNewContext("(" + compiled.factorySource + ")({})"),
    /must not execute/,
  );
});
test("server module factories bind each invocation independently and preserve default input/output and errors", async () => {
  const source = `import {signal as value,query,mutation} from 'page';const [region,setRegion]=value('$region');const rows=query('$rows');const rename=mutation('$rename');export default async function(input){setRegion(input.region);await rename({region:region()});return {rows:await rows.ready,region:region()};}`;
  const compiled = await compileLegacyServerModule(source, declarations);
  assert.deepEqual(compiled.references, declarations);
  const factory = runInNewContext("(" + compiled.factorySource + ")");
  const make = (initial: string) => {
    let region = initial;
    const writes: unknown[] = [];
    return {
      writes,
      ports: {
        signal: () => [() => region, (next: string) => (region = next)],
        query: () => ({ ready: Promise.resolve([{ initial }]) }),
        mutation: () => async (args: unknown) => {
          writes.push(args);
        },
      },
    };
  };
  const first = make("first"),
    second = make("second");
  const runFirst = factory(first.ports),
    runSecond = factory(second.ports);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await runFirst({ region: "changed" }))),
    { rows: [{ initial: "first" }], region: "changed" },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await runSecond({ region: "other" }))),
    { rows: [{ initial: "second" }], region: "other" },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(first.writes)), [
    { region: "changed" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(second.writes)), [
    { region: "other" },
  ]);
  const failed = await compileLegacyServerModule(
    'export default async function(){throw Error("handler failed")}',
    declarations,
  );
  await assert.rejects(
    runInNewContext("(" + failed.factorySource + ")({})")(),
    /handler failed/,
  );
});
test("only pinned literal page bindings and the audited server module family compile", async () => {
  for (const source of [
    "import {query} from 'page';query('$missing');export default async function(){}",
    "import {signal} from 'page';const alias=signal;export default async function(){return alias('$region')}",
    "import {query} from 'page';export default async function(input){return query(input.name)}",
    "import x from 'external-package';export default async function(){}",
    "import * as page from 'page';export default async function(){}",
    "export default async function(){return import('page')}",
    "export default async function(){return fetch('https://example.test')}",
    "export default async function(){return eval('1')}",
    "export default async function(input,context){return context}",
    "export const helper=1;export default async function(){}",
    "export default {}",
  ])
    await assert.rejects(
      compileLegacyServerModule(source, declarations),
      source,
    );
});
test("default input arguments retain their authored fallback without host substitution", async () => {
  const compiled = await compileLegacyServerModule(
    "export default async function(input={count:2}){return input.count}",
    { values: [], queries: [], mutations: [] },
  );
  const handler = runInNewContext("(" + compiled.factorySource + ")({})");
  assert.equal(await handler(), 2);
  assert.equal(await handler({ count: 4 }), 4);
  await assert.rejects(handler(null));
});
