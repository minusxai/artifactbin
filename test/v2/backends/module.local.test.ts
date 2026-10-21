import { test } from "node:test";
import assert from "node:assert/strict";
import type { BackendModuleReader } from "../../../src/backend/af-backend-contracts.ts";
import { load } from "../support/load.ts";
import { skillExample } from "../support/skill.ts";

const reader = () => load<BackendModuleReader>("src/backend/af-module.ts");
const billing = () => skillExample("SKILL.md", "type Invoice {").code;

test("the schema of SKILL.md's billing.ts is read without running it", async () => {
  const { readBackendModule } = await reader();
  const info = await readBackendModule(billing());
  assert.match(info.typeDefs, /type Invoice \{ id: ID!  total: Float!  paid: Boolean! \}/);
  assert.match(info.typeDefs, /pay\(invoice: ID!\): Invoice! @auth\(role: EDITOR\)/);
  assert.deepEqual(info.imports, ["@afbin/apollo"]);
});

test("typeDefs may be a plain string", async () => {
  const { readBackendModule } = await reader();
  const info = await readBackendModule(
    "export const typeDefs = 'type Query { hello: String! }';\nexport default { Query: { hello: () => 'hi' } };\n",
  );
  assert.equal(info.typeDefs, "type Query { hello: String! }");
  assert.deepEqual(info.imports, []);
});

test("backend files that break the rules are refused with a reason", async () => {
  const { readBackendModule } = await reader();
  const cases: [string, string][] = [
    ["import { gql } from '@afbin/apollo';\nconst t = 'Int';\nexport const typeDefs = gql`type Query { n: ${t} }`;\nexport default { Query: { n: () => 1 } };", "typedefs-not-static"],
    ["export const typeDefs = ['type Query { n: Int }'].join('');\nexport default { Query: { n: () => 1 } };", "typedefs-not-static"],
    ["export default { Query: { n: () => 1 } };", "typedefs-missing"],
    ["export const typeDefs = 'type Query { n: Int }';\nexport const resolvers = { Query: { n: () => 1 } };", "default-export-missing"],
    ["import pg from 'pg';\nexport const typeDefs = 'type Query { n: Int }';\nexport default { Query: { n: () => 1 } };", "import-not-allowed"],
    ["import { x } from './helper';\nexport const typeDefs = 'type Query { n: Int }';\nexport default { Query: { n: () => x } };", "import-not-allowed"],
    ["export const typeDefs = 'type Query { n: Missing }';\nexport default { Query: { n: () => 1 } };", "schema-invalid"],
  ];
  for (const [source, problem] of cases)
    await assert.rejects(readBackendModule(source), { name: "BackendModuleError", problem }, problem);
});

test("pinned npm packages and node: built-ins may be imported; an unpinned package is refused with the fix", async () => {
  const { readBackendModule } = await reader();
  const info = await readBackendModule(
    "import postgres from 'postgres@3.4.5';\nimport { createHash } from 'node:crypto';\nimport Stripe from '@stripe/stripe-js@4.0.0/pure';\nexport const typeDefs = 'type Query { n: Int }';\nexport default { Query: { n: () => 1 } };",
  );
  assert.deepEqual(info.imports.sort(), ["@stripe/stripe-js@4.0.0/pure", "node:crypto", "postgres@3.4.5"]);
  await assert.rejects(
    readBackendModule("import pg from 'pg@^8';\nexport const typeDefs = 'type Query { n: Int }';\nexport default { Query: { n: () => 1 } };"),
    { problem: "import-not-allowed", message: /"pg@1\.2\.3"/ },
  );
});

test("the skill's postgres examples are backend files the platform accepts", async () => {
  const { readBackendModule } = await reader();
  for (const [file, marker] of [["SKILL.md", "count: Int!"], ["references/backend.md", "type Order"]] as const) {
    const info = await readBackendModule(skillExample(file, marker).code);
    assert.ok(info.imports.includes("postgres@3.4.5"), file);
    assert.match(info.typeDefs, /@auth\(signedIn: true\)/, `${file}: a field that reads with a secret carries @auth`);
  }
});
