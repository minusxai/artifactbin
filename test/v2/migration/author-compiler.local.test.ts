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
