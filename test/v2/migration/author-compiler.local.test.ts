// @requires archived-compiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileAuthorScript } from "../../../src/migration/conversion/compiled/author/compiler.ts";
const archivedRoot = process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test(
  "offline compiler transforms author text without executing its module",
  { skip: !archivedRoot },
  async () => {
    const output = await compileAuthorScript(
      `throw Error('authored module must never execute on the server');export function Example(){return <p>Ready</p>}`,
      { values: [], queries: [], mutations: [] },
      { archivedRoot: archivedRoot! },
    );
    assert.deepEqual(output.exports, ["Example"]);
    assert.doesNotMatch(output.code, /__mxPageBindings|\/api\/|\/islands\//);
  },
);

test(
  "pinned compiler admits declared mutation ABI and still rejects computed or wrong-kind binding",
  { skip: !archivedRoot },
  async () => {
    const source = `import {mutation} from 'page';export function Save(){const save=mutation('$save');return <button onClick={async()=>{await save({amount:3,_row:{id:1}})}}>Save</button>}`;
    const result = await compileAuthorScript(
      source,
      { values: [], queries: [], mutations: ["save"] },
      { archivedRoot: archivedRoot! },
    );
    assert.deepEqual(result.exports, ["Save"]);
    assert.doesNotMatch(result.code, /__mxPageBindings/);
    for (const bad of [
      source.replace("'$save'", "'$other'"),
      source.replace("'$save'", "'$value'"),
      source.replace("mutation('$save')", "mutation('$'+'save')"),
    ])
      await assert.rejects(
        compileAuthorScript(
          bad,
          { values: ["value"], queries: [], mutations: ["save"] },
          { archivedRoot: archivedRoot! },
        ),
      );
  },
);
