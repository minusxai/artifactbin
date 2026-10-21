import { test } from "node:test";
import assert from "node:assert/strict";
import type { AfJson } from "../../../src/af-contracts.ts";
import {
  FieldFailed,
  FieldNotExecuted,
  type FieldCall,
  type NamespaceModule,
  type NamespaceSource,
  type PageCaller,
} from "../../../src/graphql/af-namespace-contracts.ts";
import { load } from "../support/load.ts";
import { skillExample } from "../support/skill.ts";

const namespaces = () => load<NamespaceModule>("src/graphql/af-namespaces.ts");

/** The typeDefs of SKILL.md's backends/billing.ts example, as written. */
const billingTypeDefs = (() => {
  const code = skillExample("SKILL.md", "type Invoice {").code;
  const sdl = /typeDefs = gql`([\s\S]*?)`;/.exec(code)?.[1];
  assert.ok(sdl);
  return sdl;
})();
const contactsTypeDefs = `
  type Invoice { id: ID! }
  type Contact { name: String! }
  type Query { search(q: String!): [Contact!]! }
  type Mutation { add(name: String!): Contact! @auth(signedIn: true) list: [Invoice!]! }
`;
const sources: NamespaceSource[] = [
  { name: "billing", fileId: "Bk7Qa2", version: "v-billing", typeDefs: billingTypeDefs },
  { name: "contacts", fileId: "Cr4mZ9", version: "v-contacts", typeDefs: contactsTypeDefs },
];
const editor: PageCaller = { pageId: "Pg4mQ2", subject: "ann@example.test", role: "EDITOR" };
const viewer: PageCaller = { pageId: "Pg4mQ2", subject: "bob@example.test", role: "VIEWER" };
const anonymous: PageCaller = { pageId: "Pg4mQ2", subject: null, role: "VIEWER" };

function recorder(answer: (call: FieldCall) => Promise<AfJson> | AfJson) {
  const calls: FieldCall[] = [];
  return {
    calls,
    invoke: async (call: FieldCall) => {
      calls.push(call);
      return answer(call);
    },
  };
}

test("two files may both define Invoice; each is queried under its name", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema(sources);
  assert.deepEqual([...schema.namespaces], ["billing", "contacts"]);
  const { calls, invoke } = recorder((call) =>
    call.field === "invoices"
      ? [{ id: "1", total: 9.5, paid: false, secret: "dropped" }]
      : [{ name: "Ann" }],
  );
  const result = await executePageOperation({
    schema,
    caller: editor,
    invoke,
    request: { query: '{ billing { invoices { id total paid } } contacts { search(q: "ann") { name } } }' },
  });
  assert.equal(result.errors, undefined);
  assert.deepEqual(result.data, {
    billing: { invoices: [{ id: "1", total: 9.5, paid: false }] },
    contacts: { search: [{ name: "Ann" }] },
  });
  const search = calls.find((call) => call.field === "search")!;
  assert.deepEqual(
    { namespace: search.namespace, fileId: search.fileId, version: search.version, operation: search.operation, args: search.args },
    { namespace: "contacts", fileId: "Cr4mZ9", version: "v-contacts", operation: "query", args: { q: "ann" } },
  );
  assert.deepEqual(search.principal, { tenant: "Pg4mQ2", subject: "ann@example.test" });
});

test("namespace names must be unique GraphQL names", async () => {
  const { composePageSchema } = await namespaces();
  assert.throws(() => composePageSchema([sources[0]!, { ...sources[1]!, name: "billing" }]), /billing/);
  assert.throws(() => composePageSchema([{ ...sources[0]!, name: "bad-name" }]), /bad-name/);
  assert.throws(() => composePageSchema([{ ...sources[0]!, typeDefs: "type Query { broken" }]), /billing/);
});

test("@auth is checked before the resolver runs", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema(sources);
  const pay = { query: 'mutation { billing { pay(invoice: "42") { id paid } } }' };
  const refused = recorder(() => ({ id: "42", total: 1, paid: true }));
  const asViewer = await executePageOperation({ schema, caller: viewer, invoke: refused.invoke, request: pay });
  assert.equal(refused.calls.length, 0);
  assert.deepEqual(asViewer.extensions?.outcomes, { "billing.pay": "rejected" });
  assert.deepEqual(asViewer.errors?.[0]?.path, ["billing", "pay"]);
  const allowed = recorder(() => ({ id: "42", total: 1, paid: true }));
  const asEditor = await executePageOperation({ schema, caller: editor, invoke: allowed.invoke, request: pay });
  assert.deepEqual(asEditor.data, { billing: { pay: { id: "42", paid: true } } });
  assert.deepEqual(asEditor.extensions?.outcomes, { "billing.pay": "committed" });
  const owner = await executePageOperation({ schema, caller: { ...editor, role: "OWNER" }, invoke: allowed.invoke, request: pay });
  assert.deepEqual(owner.extensions?.outcomes, { "billing.pay": "committed" }, "OWNER includes EDITOR");

  const add = { query: 'mutation { contacts { add(name: "Cy") { name } } }' };
  const signedOut = recorder(() => ({ name: "Cy" }));
  const anon = await executePageOperation({ schema, caller: anonymous, invoke: signedOut.invoke, request: add });
  assert.equal(signedOut.calls.length, 0);
  assert.deepEqual(anon.extensions?.outcomes, { "contacts.add": "rejected" });
  const open = await executePageOperation({
    schema,
    caller: anonymous,
    invoke: recorder(() => [{ name: "Ann" }]).invoke,
    request: { query: '{ contacts { search(q: "a") { name } } }' },
  });
  assert.deepEqual(open.data, { contacts: { search: [{ name: "Ann" }] } }, "no @auth: anyone who can open the page");
  const outsider = recorder(() => [{ name: "Ann" }]);
  const closed = await executePageOperation({
    schema,
    caller: { ...anonymous, role: null },
    invoke: outsider.invoke,
    request: { query: '{ contacts { search(q: "a") { name } } }' },
  });
  assert.equal(outsider.calls.length, 0);
  assert.ok(closed.errors?.length);
});

test("mutation fields run one at a time in the order written, each with its own outcome", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema(sources);
  const log: string[] = [];
  let active = 0;
  const invoke = async (call: FieldCall): Promise<AfJson> => {
    assert.equal(active, 0, "the previous field has settled");
    active++;
    log.push(`${call.namespace}.${call.field}(${JSON.stringify(call.args)})`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (call.args.invoice === "bad") throw new FieldNotExecuted();
    if (call.args.invoice === "boom") throw new Error("resolver failed half-way");
    return call.field === "add" ? { name: String(call.args.name) } : { id: String(call.args.invoice), total: 1, paid: true };
  };
  const result = await executePageOperation({
    schema,
    caller: editor,
    invoke,
    request: {
      query: `mutation {
        billing { first: pay(invoice: "1") { id } second: pay(invoice: "bad") { id } }
        contacts { add(name: "Di") { name } }
        later: billing { pay(invoice: "boom") { id } }
      }`,
    },
  });
  assert.deepEqual(log, [
    'billing.pay({"invoice":"1"})',
    'billing.pay({"invoice":"bad"})',
    'contacts.add({"name":"Di"})',
    'billing.pay({"invoice":"boom"})',
  ]);
  assert.deepEqual(result.extensions?.outcomes, {
    "billing.first": "committed",
    "billing.second": "rejected",
    "contacts.add": "committed",
    "later.pay": "unknown",
  });
  assert.deepEqual(result.data, {
    billing: { first: { id: "1" }, second: null },
    contacts: { add: { name: "Di" } },
    later: { pay: null },
  });
});

test("a failed backend field says why in extensions.code, keeping its fixed message", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema(sources);
  const invoke = async (call: FieldCall): Promise<AfJson> => {
    switch (call.args.invoice) {
      case "busy":
        throw new FieldNotExecuted("backend_busy", "backend_busy");
      case "slow":
        throw new FieldFailed("deadline");
      case "odd":
        throw new FieldFailed("Not a code: /etc/passwd");
      case "plain":
        throw new Error("stderr: secret source line 3");
    }
    return { id: "1", total: 1, paid: true };
  };
  const result = await executePageOperation({
    schema,
    caller: editor,
    invoke,
    request: {
      query: `mutation {
        billing {
          busy: pay(invoice: "busy") { id }
          slow: pay(invoice: "slow") { id }
          odd: pay(invoice: "odd") { id }
          plain: pay(invoice: "plain") { id }
        }
      }`,
    },
  });
  assert.deepEqual(result.extensions?.outcomes, {
    "billing.busy": "rejected",
    "billing.slow": "unknown",
    "billing.odd": "unknown",
    "billing.plain": "unknown",
  });
  const byPath = Object.fromEntries((result.errors ?? []).map((error) => [error.path!.join("."), error]));
  assert.deepEqual(byPath["billing.busy"], {
    message: "Backend request rejected before execution",
    path: ["billing", "busy"],
    extensions: { code: "backend_busy" },
  });
  assert.deepEqual(byPath["billing.slow"], {
    message: "Backend execution failed",
    path: ["billing", "slow"],
    extensions: { code: "deadline" },
  });
  // Anything that is not a short code, and any other error, adds nothing.
  assert.deepEqual(byPath["billing.odd"], { message: "Backend execution failed", path: ["billing", "odd"] });
  assert.deepEqual(byPath["billing.plain"], { message: "Backend execution failed", path: ["billing", "plain"] });

  // Queries carry the code too, and validation errors never gain one.
  const query = await executePageOperation({
    schema: composePageSchema([{ name: "me", fileId: "Me0000", version: "v1", typeDefs: "type Query { n: Int }" }]),
    caller: editor,
    invoke: async () => {
      throw new FieldFailed("memory_limit");
    },
    request: { query: "{ me { n } }" },
  });
  assert.deepEqual(query.errors, [{ message: "Backend execution failed", path: ["me", "n"], extensions: { code: "memory_limit" } }]);
  const invalid = await executePageOperation({ schema, caller: editor, invoke, request: { query: "{ nope }" } });
  assert.ok(invalid.errors?.length);
  assert.ok(invalid.errors!.every((error) => error.extensions === undefined));
});

test("the caller comes from the server, never from arguments", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema([
    { name: "me", fileId: "Me0000", version: "v1", typeDefs: "type Query { whoami(subject: String): String! }" },
  ]);
  const { calls, invoke } = recorder((call) => String(call.principal.subject));
  const result = await executePageOperation({
    schema,
    caller: viewer,
    invoke,
    request: { query: '{ me { whoami(subject: "admin@example.test") } }' },
  });
  assert.deepEqual(result.data, { me: { whoami: "bob@example.test" } });
  assert.deepEqual(calls[0]!.principal, { tenant: "Pg4mQ2", subject: "bob@example.test" });
});

test("invalid requests and wrong result shapes never reach or trust a resolver", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema(sources);
  const unused = recorder(() => null);
  const invalid = await executePageOperation({ schema, caller: editor, invoke: unused.invoke, request: { query: "{ billing { nope } }" } });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors?.length);
  assert.equal(unused.calls.length, 0);
  const wrong = await executePageOperation({
    schema,
    caller: editor,
    invoke: recorder(() => "not a list").invoke,
    request: { query: "{ billing { invoices { id } } }" },
  });
  assert.ok(wrong.errors?.some((e) => e.path?.join(".") === "billing.invoices"));
});

test("the page owner, and only the owner, learns what a failed backend said in extensions.detail", async () => {
  const { composePageSchema, executePageOperation } = await namespaces();
  const schema = composePageSchema(sources);
  const invoke = async (call: FieldCall): Promise<AfJson> => {
    switch (call.args.invoice ?? call.args.q) {
      case "boom":
        throw new FieldFailed("backend_rejected", "Cannot read properties of undefined (reading 'total')\n    at pay (backend.ts:12:7)");
      case "huge":
        throw new FieldNotExecuted("store_limit", "store_limit", "The store document is limited to 60 KB of JSON");
      case "long":
        throw new FieldFailed("backend_rejected", "x".repeat(10000));
      case "odd":
        throw new FieldFailed("Not a code", "never shown");
    }
    return { id: "1", total: 1, paid: true };
  };
  const request = {
    query: `mutation {
      billing {
        boom: pay(invoice: "boom") { id }
        huge: pay(invoice: "huge") { id }
        long: pay(invoice: "long") { id }
        odd: pay(invoice: "odd") { id }
      }
    }`,
  };
  const owner = await executePageOperation({ schema, caller: { ...editor, role: "OWNER" }, invoke, request });
  assert.deepEqual(owner.extensions?.outcomes, {
    "billing.boom": "unknown",
    "billing.huge": "rejected",
    "billing.long": "unknown",
    "billing.odd": "unknown",
  });
  const byPath = (result: Awaited<ReturnType<typeof executePageOperation>>) =>
    Object.fromEntries((result.errors ?? []).map((error) => [error.path!.join("."), error]));
  const seen = byPath(owner);
  assert.deepEqual(seen["billing.boom"], {
    message: "Backend execution failed",
    path: ["billing", "boom"],
    extensions: { code: "backend_rejected", detail: "Cannot read properties of undefined (reading 'total')" },
  });
  assert.deepEqual(seen["billing.huge"], {
    message: "Backend request rejected before execution",
    path: ["billing", "huge"],
    extensions: { code: "store_limit", detail: "The store document is limited to 60 KB of JSON" },
  });
  assert.equal(seen["billing.long"]!.extensions?.detail, "x".repeat(200));
  assert.deepEqual(seen["billing.odd"], { message: "Backend execution failed", path: ["billing", "odd"] });
  // Editors, viewers and anonymous viewers get the code alone (viewers through a field they may call).
  const editorSees = byPath(await executePageOperation({ schema, caller: editor, invoke, request }));
  assert.deepEqual(editorSees["billing.boom"]!.extensions, { code: "backend_rejected" });
  assert.deepEqual(editorSees["billing.huge"]!.extensions, { code: "store_limit" });
  const open = { query: '{ contacts { boom: search(q: "boom") { name } huge: search(q: "huge") { name } } }' };
  for (const caller of [viewer, anonymous]) {
    const result = byPath(await executePageOperation({ schema, caller, invoke, request: open }));
    assert.deepEqual(result["contacts.boom"]!.extensions, { code: "backend_rejected" }, String(caller.subject));
    assert.deepEqual(result["contacts.huge"]!.extensions, { code: "store_limit" }, String(caller.subject));
    assert.ok(!JSON.stringify(result).includes("Cannot read"));
  }
  assert.ok(!JSON.stringify(editorSees).includes("Cannot read"));
});
