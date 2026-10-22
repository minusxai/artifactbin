import { test } from "node:test";
import assert from "node:assert/strict";
import type { AfJsonObject } from "../../../src/af-contracts.ts";
import type { ApolloModule, StatePort } from "../../../src/apollo/apollo-contracts.ts";
import { load } from "../support/load.ts";
import { skillExample, skillFile } from "../support/skill.ts";
import { runSnippet } from "../support/snippet.ts";

const apollo = () => load<ApolloModule>("src/apollo/client.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A store whose first write waits until `release()`, so another viewer can commit first. */
function heldFirstWrite(base: StatePort) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  const port: StatePort = {
    read: () => base.read(),
    subscribe: (listener) => base.subscribe(listener),
    async write(change) {
      if (first) {
        first = false;
        await held;
      }
      return base.write(change);
    },
  };
  return { port, release };
}

test("the SKILL.md products example: watch, then add with updateQuery", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const example = skillExample("SKILL.md", "const PRODUCTS").code;
  assert.match(example, /client\.watchQuery\(\{ query: PRODUCTS \}\)\.subscribe/);
  assert.match(example, /client\.updateQuery\(\{ query: PRODUCTS \}, \(data\) =>/);
  const client = createClient({ backends: [], state: createLocalStore() });
  const PRODUCTS = gql`{ products { id name price } }`;
  const seen: unknown[] = [];
  const subscription = client.watchQuery({ query: PRODUCTS }).subscribe(({ data }) => seen.push(data));
  assert.deepEqual(seen, [{ products: null }], "called straight away; a field never written is null");
  await client.updateQuery({ query: PRODUCTS }, (data: AfJsonObject) => ({
    products: [...((data.products as AfJsonObject[] | null) ?? []), { id: "1", name: "Lamp", price: 40 }],
  }));
  assert.deepEqual(seen.at(-1), { products: [{ id: "1", name: "Lamp", price: 40 }] });
  subscription.unsubscribe();
  await client.updateQuery({ query: PRODUCTS }, () => ({ products: [] }));
  assert.equal(seen.length, 2, "no calls after unsubscribe");
});

test("watchQuery only fires for the fields its query names", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const client = createClient({ backends: [], state: createLocalStore({ a: 1, b: 1 }) });
  let calls = 0;
  client.watchQuery({ query: gql`{ a }` }).subscribe(() => calls++);
  await client.updateQuery({ query: gql`{ b }` }, () => ({ b: 2 }));
  assert.equal(calls, 1);
  await client.updateQuery({ query: gql`{ a }` }, () => ({ a: 2 }));
  assert.equal(calls, 2);
});

test("queries read the document in the query's shape", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const client = createClient({
    backends: [],
    state: createLocalStore({
      todos: [{ id: "1", text: "Write", done: false, tags: ["a"] }],
      settings: { theme: "warm", size: 2 },
    }),
  });
  const { data, errors } = await client.query({ query: gql`{ todos { id text } settings missing }` });
  assert.equal(errors, undefined);
  assert.deepEqual(data, {
    todos: [{ id: "1", text: "Write" }],
    settings: { theme: "warm", size: 2 },
    missing: null,
  });
  const withArgs = await client.query({ query: gql`{ todos(first: 1) { id } }` });
  assert.ok(withArgs.errors?.length, "local fields take no arguments");
});

test("updateQuery replaces only the fields its query names", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const store = createLocalStore({ todos: [{ id: "1", text: "a", done: true }], title: "Kept" });
  const client = createClient({ backends: [], state: store });
  const saved = await client.updateQuery({ query: gql`{ todos { id text } }` }, (data: AfJsonObject) => ({
    todos: [...(data.todos as AfJsonObject[]), { id: "2", text: "b" }],
  }));
  assert.deepEqual(saved, { todos: [{ id: "1", text: "a" }, { id: "2", text: "b" }] });
  assert.deepEqual(store.read(), {
    todos: [{ id: "1", text: "a" }, { id: "2", text: "b" }],
    title: "Kept",
  });
  await assert.rejects(client.updateQuery({ query: gql`{ todos { id } }` }, () => ({ todos: [], title: "x" })));
  assert.equal(store.read().title, "Kept", "a key outside the query is refused, and nothing is saved");
});

test("only plain data can be stored", async () => {
  const { gql, createClient, createLocalStore, ...rest } = await apollo();
  const assertStorable: ApolloModule["assertStorable"] = rest.assertStorable;
  for (const ok of [null, "s", 0, -1.5, true, [], [1, [2]], { a: { b: [null] } }]) assertStorable(ok);
  class Point {
    x = 1;
  }
  const sparse = [1, , 3];
  for (const bad of [undefined, NaN, Infinity, -Infinity, () => 1, new Date(), new Point(), new Map(), sparse, { a: undefined }, { a: [NaN] }])
    assert.throws(() => assertStorable(bad), TypeError, String(bad));
  const store = createLocalStore({ when: "2026-10-20" });
  const client = createClient({ backends: [], state: store });
  await assert.rejects(client.updateQuery({ query: gql`{ when }` }, () => ({ when: new Date() as never })), TypeError);
  assert.deepEqual(store.read(), { when: "2026-10-20" }, "dates are stored as ISO strings; a Date is refused");
});

test("when two viewers update the same field at once, the second fn reruns on the first's result", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const shared = createLocalStore();
  const slow = heldFirstWrite(shared);
  const viewerA = createClient({ backends: [], state: slow.port });
  const viewerB = createClient({ backends: [], state: shared });
  const TODOS = gql`{ todos }`;
  let calls = 0;
  const pending = viewerA.updateQuery({ query: TODOS }, (d: AfJsonObject) => {
    calls++;
    return { todos: [...((d.todos as string[] | null) ?? []), "from A"] };
  });
  await tick();
  await viewerB.updateQuery({ query: TODOS }, (d: AfJsonObject) => ({ todos: [...((d.todos as string[] | null) ?? []), "from B"] }));
  slow.release();
  await pending;
  assert.equal(calls, 2);
  assert.deepEqual(shared.read(), { todos: ["from B", "from A"] }, "neither change is lost");
});

test("updateQuery gives up after maxAttempts conflicts", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const base = createLocalStore({ n: 0 });
  let bump = 0;
  const contested: StatePort = {
    read: () => base.read(),
    subscribe: (listener) => base.subscribe(listener),
    async write() {
      return { status: "conflict", document: { n: ++bump } };
    },
  };
  const client = createClient({ backends: [], state: contested, maxAttempts: 3 });
  let calls = 0;
  await assert.rejects(client.updateQuery({ query: gql`{ n }` }, (d: AfJsonObject) => (calls++, { n: (d.n as number) + 1 })));
  assert.equal(calls, 3);
});

test("the state.md vote example: named local mutations combine instead of replacing", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const shared = createLocalStore();
  const slow = heldFirstWrite(shared);
  const viewerA = createClient({ backends: [], state: slow.port });
  const viewerB = createClient({ backends: [], state: shared });
  const example = skillExample("references/state.md", "vote").code;
  assert.match(example, /client\.addResolvers\(/);
  const first = runSnippet(example, { "@afbin/apollo": { gql, client: viewerA } });
  await tick();
  await runSnippet(example, { "@afbin/apollo": { gql, client: viewerB } });
  slow.release();
  await first;
  assert.deepEqual(shared.read(), { votes: 2 });
  const result = await viewerB.mutate({ mutation: gql`mutation { vote }` });
  assert.deepEqual(result.data, { vote: 3 });
});

test("a local mutation reruns when any field it could have read changed meanwhile", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const shared = createLocalStore({ enabled: true, count: 1 });
  const slow = heldFirstWrite(shared);
  const viewerA = createClient({ backends: [], state: slow.port });
  const viewerB = createClient({ backends: [], state: shared });
  let runs = 0;
  viewerA.addResolvers({
    Mutation: {
      spend(draft) {
        runs++;
        if (draft.enabled) draft.count = (draft.count as number) - 1;
        return draft.count;
      },
    },
  });
  const pending = viewerA.mutate({ mutation: gql`mutation { spend }` });
  await tick();
  await viewerB.updateQuery({ query: gql`{ enabled }` }, () => ({ enabled: false }));
  slow.release();
  const result = await pending;
  assert.equal(runs, 2, "the decision was remade on the latest state");
  assert.deepEqual(result.data, { spend: 1 });
  assert.deepEqual(shared.read(), { enabled: false, count: 1 }, "nothing was spent while disabled");
});

test("a local mutation reruns when a field it saw absent was added meanwhile", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const shared = createLocalStore({ count: 0 });
  const slow = heldFirstWrite(shared);
  const viewerA = createClient({ backends: [], state: slow.port });
  const viewerB = createClient({ backends: [], state: shared });
  let runs = 0;
  viewerA.addResolvers({
    Mutation: {
      bump(draft) {
        runs++;
        // Reads note's absence, writes a different field.
        if (draft.note === undefined) draft.count = (draft.count as number) + 1;
        return draft.count;
      },
    },
  });
  const pending = viewerA.mutate({ mutation: gql`mutation { bump }` });
  await tick();
  await viewerB.updateQuery({ query: gql`{ note }` }, () => ({ note: "from B" }));
  slow.release();
  const result = await pending;
  assert.equal(runs, 2, "the decision was remade on the latest state");
  assert.deepEqual(result.data, { bump: 0 });
  assert.deepEqual(shared.read(), { count: 0, note: "from B" }, "nothing was counted once a note existed");
});

test("an exact write conflicts when the document holds a field it does not expect", async () => {
  const { createLocalStore } = await apollo();
  const store = createLocalStore({ n: 1, extra: true });
  assert.equal((await store.write({ expected: { n: 1 }, next: { n: 2 }, exact: true })).status, "conflict");
  assert.equal((await store.write({ expected: { n: 1 }, next: { n: 2 } })).status, "committed", "without the flag, other fields are ignored");
  assert.equal(
    (await store.write({ expected: { n: 2, extra: true, gone: undefined }, next: { n: 3 }, exact: true })).status,
    "committed",
    "a field expected absent counts as expected",
  );
  assert.deepEqual(store.read(), { n: 3, extra: true });
});

test("a variable left out takes its declared default", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const client = createClient({ backends: [], state: createLocalStore({ n: 7, m: 8 }) });
  const SHOW = gql`
    query Show($show: Boolean! = true) {
      n @include(if: $show)
      m
    }
  `;
  assert.deepEqual((await client.query({ query: SHOW })).data, { n: 7, m: 8 });
  assert.deepEqual((await client.query({ query: SHOW, variables: { show: false } })).data, { m: 8 });
});

test("a local resolver that throws saves nothing", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  const store = createLocalStore({ stock: 1 });
  const client = createClient({ backends: [], state: store });
  client.addResolvers({
    Mutation: {
      take(draft) {
        draft.stock = (draft.stock as number) - 1;
        if ((draft.stock as number) < 0) throw Error("Out of stock");
        return draft.stock;
      },
    },
  });
  assert.deepEqual((await client.mutate({ mutation: gql`mutation { take }` })).data, { take: 0 });
  const failed = await client.mutate({ mutation: gql`mutation { take }` });
  assert.match(failed.errors?.[0]?.message ?? "", /Out of stock/);
  assert.deepEqual(store.read(), { stock: 0 });
  const unknown = await client.mutate({ mutation: gql`mutation { nothing }` });
  assert.ok(unknown.errors?.length);
});

test("the todo example watches shared results while keeping only viewer choices local", async () => {
  const { gql, createClient, createLocalStore } = await apollo();
  // Execute the query declarations from the shipped example, rather than a
  // duplicate query that can keep passing after the example changes.
  const todo = skillFile("examples/todo.html");
  const declarations = ["VIEW", "FILTER", "DRAFT"].map((name) => {
    const declaration = todo.match(new RegExp("const " + name + " = gql`[^`]+`;"));
    assert.ok(declaration, `example declares ${name}`);
    return "export " + declaration[0];
  });
  const queries = await runSnippet(
    "import { gql } from '@afbin/apollo';\n" + declarations.join("\n"),
    { "@afbin/apollo": { gql } },
  );
  const VIEW = queries.VIEW as ReturnType<typeof gql>;
  const FILTER = queries.FILTER as ReturnType<typeof gql>;
  const DRAFT = queries.DRAFT as ReturnType<typeof gql>;
  const store = createLocalStore();
  const listeners = new Set<() => void>();
  let rows: AfJsonObject[] = [{ id: "1", text: "Ship", done: true }];
  const client = createClient({ backends: ["team"], state: store, remote: {
    online: () => true,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async execute() { return { data: { team: { list: rows } } }; },
  } });
  let latest: AfJsonObject = {};
  const subscription = client.watchQuery({ query: VIEW }).subscribe(({ data }) => (latest = data));
  assert.deepEqual(latest, { team: null, filter: null, draft: null });
  await tick();
  await client.updateQuery({ query: FILTER }, () => ({ filter: "done" }));
  await client.updateQuery({ query: DRAFT }, () => ({ draft: "Milk" }));
  assert.deepEqual(latest, { team: { list: rows }, filter: "done", draft: "Milk" });
  assert.deepEqual(store.read(), { filter: "done", draft: "Milk" });
  rows = [{ id: "2", text: "Changed by another viewer", done: false }];
  for (const notify of listeners) notify();
  await tick();
  assert.deepEqual(latest, { team: { list: rows }, filter: "done", draft: "Milk" });
  assert.deepEqual(store.read(), { filter: "done", draft: "Milk" }, "remote records never become local state");
  subscription.unsubscribe();
  assert.equal(listeners.size, 0);
});
