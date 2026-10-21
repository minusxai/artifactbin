/**
 * `@auth` is checked before a resolver runs, so it only means something on a
 * file's Query and Mutation fields. Anywhere else it is refused rather than
 * silently ignored. Brief C.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NamespaceModule } from "../../../src/graphql/af-namespace-contracts.ts";
import { load } from "../support/load.ts";

test("@auth on a nested field is refused, naming the field", async () => {
  const { composePageSchema } = await load<NamespaceModule>(
    "src/graphql/af-namespaces.ts",
  );
  const source = (typeDefs: string) => ({
    name: "billing",
    fileId: "Bk7Qa2",
    version: "v1",
    typeDefs,
  });
  for (const typeDefs of [
    "type Invoice { id: ID!  secret: String @auth(role: OWNER) } type Query { invoices: [Invoice!]! }",
    "interface Node { id: ID! @auth(signedIn: true) } type Query { node: Node }",
    "type Invoice { id: ID! } extend type Invoice { secret: String @auth(role: OWNER) } type Query { invoices: [Invoice!]! }",
  ])
    assert.throws(
      () => composePageSchema([source(typeDefs)]),
      /billing.*@auth is allowed only on Query and Mutation fields/s,
    );
  const allowed = composePageSchema([
    source(
      "type Query { invoices: [ID!]! @auth(role: VIEWER) } type Mutation { pay(id: ID!): ID @auth(role: EDITOR) } extend type Query { mine: [ID!]! @auth(signedIn: true) }",
    ),
  ]);
  assert.deepEqual([...allowed.namespaces], ["billing"]);
});
