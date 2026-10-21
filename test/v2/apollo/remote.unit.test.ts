import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, print } from "graphql";
import type { AfJsonObject } from "../../../src/af-contracts.ts";
import {
  RemoteUnreachable,
  type ApolloModule,
  type RemotePort,
} from "../../../src/apollo/apollo-contracts.ts";
import { load } from "../support/load.ts";
import { skillExample } from "../support/skill.ts";
import { runSnippet } from "../support/snippet.ts";

const apollo = () => load<ApolloModule>("src/apollo/client.ts");
type Sent = Parameters<RemotePort["execute"]>[0];
type Reply = Awaited<ReturnType<RemotePort["execute"]>>;

function remote(reply: (request: Sent) => Reply, online = true) {
  const sent: Sent[] = [];
  const port: RemotePort = {
    online: () => online,
    async execute(request) {
      sent.push(request);
      return reply(request);
    },
  };
  return { port, sent };
}
const topFields = (query: string) =>
  (parse(query).definitions[0] as unknown as { selectionSet: { selections: { name: { value: string } }[] } }).selectionSet.selections.map(
    (s) => s.name.value,
  );

test("the SKILL.md remote example queries both namespaces in one request and mutates with variables", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const store = createLocalStore({ todos: [] });
  const { port, sent } = remote((request): Reply => {
    if (request.operation === "query")
      return { data: { billing: { invoices: [{ id: "42", total: 10, paid: false }] }, contacts: { search: [{ name: "Ann" }] } } };
    return { data: { billing: { pay: { id: "42", paid: true } } }, extensions: { outcomes: { "billing.pay": "committed" } } };
  });
  const client = createClient({ backends: ["billing", "contacts"], state: store, remote: port });
  const example = skillExample("SKILL.md", "contacts { search").code;
  await runSnippet(example, { "@afbin/apollo": { gql, client } });
  assert.equal(sent.length, 2);
  assert.equal(sent[0]!.operation, "query");
  assert.deepEqual(topFields(sent[0]!.query), ["billing", "contacts"]);
  assert.equal(sent[1]!.operation, "mutation");
  assert.deepEqual(sent[1]!.variables, { id: "42" });
  assert.deepEqual(topFields(sent[1]!.query), ["billing"]);
  assert.deepEqual(store.read(), { todos: [] }, "results are not stored in local state");
});

test("local and remote fields in one query are answered together", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const { port, sent } = remote(() => ({ data: { billing: { invoices: [] } } }));
  const client = createClient({ backends: ["billing"], state: createLocalStore({ todos: ["a"] }), remote: port });
  const result = await client.query({ query: gql`{ todos billing { invoices { id } } }` });
  assert.deepEqual(result.data, { todos: ["a"], billing: { invoices: [] } });
  assert.deepEqual(topFields(sent[0]!.query), ["billing"], "local fields are never sent");
});

test("mutation fields run in the order written, across local state and namespaces", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const order: string[] = [];
  const { port, sent } = remote((request) => {
    order.push("remote:" + topFields(request.query).join("+"));
    return { data: { billing: { pay: { id: "1" } } }, extensions: { outcomes: { "billing.pay": "committed" } } };
  });
  const store = createLocalStore({ votes: 0 });
  const client = createClient({ backends: ["billing"], state: store, remote: port });
  client.addResolvers({
    Mutation: {
      vote(draft) {
        order.push("local:vote");
        draft.votes = (draft.votes as number) + 1;
        return draft.votes;
      },
    },
  });
  const result = await client.mutate({
    mutation: gql`mutation { first: vote billing { pay(invoice: "1") { id } } second: vote }`,
  });
  assert.deepEqual(order, ["local:vote", "remote:billing", "local:vote"]);
  assert.equal(sent.length, 1);
  assert.deepEqual(result.data, { first: 1, billing: { pay: { id: "1" } }, second: 2 });
  assert.deepEqual(result.extensions?.outcomes, { "billing.pay": "committed" });
});

test("each remote field keeps its own outcome", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const { port } = remote(() => ({
    data: { billing: { pay: { id: "1" }, refund: null } },
    errors: [{ message: "Not allowed", path: ["billing", "refund"] }],
    extensions: { outcomes: { "billing.pay": "committed", "billing.refund": "rejected" } },
  }));
  const client = createClient({ backends: ["billing"], state: createLocalStore(), remote: port });
  const result = await client.mutate({ mutation: gql`mutation { billing { pay(invoice: "1") { id } refund(invoice: "2") { id } } }` });
  assert.deepEqual(result.extensions?.outcomes, { "billing.pay": "committed", "billing.refund": "rejected" });
  assert.deepEqual(result.errors, [{ message: "Not allowed", path: ["billing", "refund"] }]);
});

test("offline: nothing is sent and the mutation settles offline", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const { port, sent } = remote(() => ({ data: null }), false);
  const client = createClient({ backends: ["billing"], state: createLocalStore(), remote: port });
  const result = await client.mutate({ mutation: gql`mutation { billing { pay(invoice: "1") { id } } }` });
  assert.equal(sent.length, 0);
  assert.deepEqual(result.extensions?.outcomes, { "billing.pay": "offline" });
  assert.equal(result.data?.billing ?? null, null);
  assert.ok(result.errors?.length);
  const unreachable = createClient({
    backends: ["billing"],
    state: createLocalStore(),
    remote: { online: () => true, execute: async () => { throw new RemoteUnreachable(); } },
  });
  const settled = await unreachable.mutate({ mutation: gql`mutation { billing { pay(invoice: "1") { id } } }` });
  assert.deepEqual(settled.extensions?.outcomes, { "billing.pay": "offline" });
});

test("a dropped connection after sending is unknown and is not retried", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  let calls = 0;
  const client = createClient({
    backends: ["billing"],
    state: createLocalStore(),
    remote: {
      online: () => true,
      execute: async () => {
        calls++;
        throw new TypeError("network connection lost");
      },
    },
  });
  const result = await client.mutate({ mutation: gql`mutation { billing { pay(invoice: "1") { id } } }` });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.deepEqual(result.extensions?.outcomes, { "billing.pay": "unknown" });
  assert.ok(result.errors?.length);
});

test("watchQuery and updateQuery are for local state only", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const store = createLocalStore();
  const client = createClient({ backends: ["billing"], state: store, remote: remote(() => ({ data: null })).port });
  assert.throws(() => client.watchQuery({ query: gql`{ billing { invoices { id } } }` }));
  await assert.rejects(client.updateQuery({ query: gql`{ billing }` }, () => ({ billing: 1 }) as AfJsonObject));
  assert.deepEqual(store.read(), {});
});

test("gql parses once and accepts fragments", async () => {
  const { gql } = await apollo();
  const fragment = gql`fragment Item on Todo { id text }`;
  const query = gql`{ todos { ...Item } } ${fragment}`;
  assert.match(print(query), /fragment Item on Todo/);
});
