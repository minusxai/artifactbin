import { test } from "node:test";
import assert from "node:assert/strict";
import { IsolateHost } from "./host.ts";
process.env.PG_HOST_SECRET = "host-only-test-sentinel";
const p = { tenant: "a", subject: "alice" };
const source = `export const typeDefs="scalar JSON type Query {who:JSON count:Int network:JSON loop:JSON memory:JSON bad:JSON}";let count=0;export const schema={who:'JSON',count:'Int',network:'JSON',loop:'JSON',memory:'JSON',bad:'JSON'};export async function resolve(field,args,ctx){if(field==='who')return ctx;if(field==='count')return ++count;if(field==='network'){try{await fetch('http://127.0.0.1:1');return 'ESCAPED'}catch{return {blocked:true,secret:typeof process==='undefined'?null:(process.env.PG_HOST_SECRET??null)}}}if(field==='loop'){while(true){}}if(field==='memory'){let a=[];while(true){let b=new Uint8Array(8*1024*1024);b.fill(42);a.push(b)}}if(field==='bad')return undefined;return args}`;
test("real isolate contracts", async () => {
  const h = new IsolateHost();
  await h.deploy(p, "v1", source);
  assert.deepEqual(
    await h.invoke(p, {
      version: "v1",
      field: "who",
      args: { tenant: "b", subject: "evil" },
    }),
    p,
  );
  assert.equal(
    await h.invoke(p, { version: "v1", field: "count", args: null }),
    1,
  );
  assert.equal(
    await h.invoke(p, { version: "v1", field: "count", args: null }),
    1,
  );
  assert.deepEqual(
    await h.invoke(p, { version: "v1", field: "network", args: null }),
    { blocked: true, secret: null },
  );
  await assert.rejects(
    h.invoke(
      { tenant: "b", subject: "bob" },
      { version: "v1", field: "who", args: null },
    ),
    /version/,
  );
  await assert.rejects(h.deploy(p, "v1", source + "\n//changed"), /immutable/);
  await assert.rejects(h.deploy(p, "v2", "broken syntax"), /build/);
  await assert.rejects(h.deploy(p, "v2", "export const x=1"), /schema/);
  await assert.rejects(
    h.invoke(p, { version: "v2", field: "who", args: null }),
    /version/,
  );
  await assert.rejects(
    h.invoke(p, { version: "v1", field: "bad", args: null }),
    /output/,
  );
  await assert.rejects(
    h.invoke(p, { version: "v1", field: "missing", args: null }),
    /field/,
  );
  await assert.rejects(
    h.invoke(p, { version: "v1", field: "who", args: "x".repeat(70000) }),
    /input/,
  );
  await assert.rejects(
    h.invoke(p, { version: "v1", field: "who", args: NaN }),
    /JSON/,
  );
  await assert.rejects(
    h.invoke(p, { version: "v1", field: "loop", args: null }),
    /deadline/,
  );
  assert.equal(h.active, 0);
  const ac = new AbortController();
  const running = h.invoke(
    p,
    { version: "v1", field: "loop", args: null },
    ac.signal,
  );
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(running, /cancelled/);
  assert.equal(h.active, 0);
  await assert.rejects(
    h.invoke(p, { version: "v1", field: "memory", args: null }),
    /memory/,
  );
  assert.equal(h.active, 0);
  assert.deepEqual(
    await h.invoke(p, { version: "v1", field: "who", args: null }),
    p,
  );
  console.log(JSON.stringify(h.measurements));
});

test("output budget is enforced and aborted-before-start does not allocate", async () => {
  const h = new IsolateHost();
  await h.deploy(
    p,
    "big",
    `export const typeDefs="type Query {big:String}";export const schema={big:'String'};export const resolve=()=> 'x'.repeat(70000)`,
  );
  await assert.rejects(
    h.invoke(p, { version: "big", field: "big", args: null }),
    /output quota/,
  );
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    h.invoke(p, { version: "big", field: "big", args: null }, ac.signal),
    /cancelled/,
  );
  assert.equal(h.active, 0);
});
test("explicit capability carries original principal, denies raw network, and enforces call budget", async () => {
  const seen: any[] = [];
  const h = new IsolateHost(undefined, async (principal, request) => {
    seen.push({ principal, request });
    return { tenant: principal.tenant };
  });
  await h.deploy(
    p,
    "cap",
    `export const typeDefs="scalar JSON type Query {cap:JSON quota:JSON}";export const schema={cap:'JSON',quota:'JSON'};export async function resolve(field,args,ctx,caps){ctx.tenant='evil';if(field==='quota'){for(let i=0;i<9;i++)await caps.invoke(args)}return caps.invoke(args)}`,
  );
  // Frozen context mutation is rejected in ESM; it cannot overwrite authority.
  await assert.rejects(
    h.invoke(p, { version: "cap", field: "cap", args: { tenant: "evil" } }),
    /output/,
  );
  assert.equal(seen.length, 0);
  await h.deploy(
    p,
    "cap2",
    `export const typeDefs="scalar JSON type Query {cap:JSON quota:JSON}";export const schema={cap:'JSON',quota:'JSON'};export async function resolve(field,args,ctx,caps){if(field==='quota'){for(let i=0;i<9;i++)await caps.invoke(args)}return caps.invoke(args)}`,
  );
  assert.deepEqual(
    await h.invoke(p, {
      version: "cap2",
      field: "cap",
      args: { tenant: "evil" },
    }),
    { tenant: "a" },
  );
  assert.equal(seen[0].principal.subject, "alice");
  await assert.rejects(
    h.invoke(p, { version: "cap2", field: "quota", args: null }),
    /output/,
  );
  assert.equal(seen.length, 9);
  assert.equal(h.active, 0);
});
test("compiler denies ambient host filesystem imports and immutable deploy races", async () => {
  const h = new IsolateHost();
  await assert.rejects(
    h.deploy(
      p,
      "fs",
      `import secret from '/tmp/host-private.json';export const schema={x:'JSON'};export const resolve=()=>secret`,
    ),
    /build/,
  );
  const outcomes = await Promise.allSettled([
    h.deploy(p, "race", source),
    h.deploy(p, "race", source),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
});

test("source budget and cancellation during asynchronous setup", async () => {
  const h = new IsolateHost();
  await assert.rejects(h.deploy(p, "huge", " ".repeat(262145)), /source quota/);
  await h.deploy(p, "abort", source);
  const ac = new AbortController();
  const run = h.invoke(
    p,
    { version: "abort", field: "loop", args: null },
    ac.signal,
  );
  queueMicrotask(() => ac.abort());
  await assert.rejects(run, /cancelled/);
  assert.equal(h.active, 0);
});

test("SDL and resolver bundle publish together and failed revision leaves old version intact", async () => {
  const h = new IsolateHost();
  await h.deploy(p, "old", source);
  const previous = h.schemaOf(p, "old");
  await assert.rejects(
    h.deploy(
      p,
      "new",
      `export const typeDefs="type Query { other:Int }";export const schema={x:'Int'};export const resolve=()=>1`,
    ),
    /schema/,
  );
  assert.equal(h.schemaOf(p, "old"), previous);
  assert.throws(() => h.schemaOf(p, "new"), /version/);
  await h.deploy(
    p,
    "new",
    `export const typeDefs="type Query { x:Int }";export const schema={x:'Int'};export const resolve=()=>2`,
  );
  assert.match(h.schemaOf(p, "new"), /x:Int/);
  assert.equal(
    await h.invoke(p, { version: "new", field: "x", args: null }),
    2,
  );
  assert.equal(h.schemaOf(p, "old"), previous);
});

test("strict JSON rejects accessors, symbols and holes; caller mutation cannot alter authority", async () => {
  const h = new IsolateHost();
  await h.deploy(p, "json", source);
  let accessed = false;
  for (const args of [
    Array(2),
    { [Symbol("x")]: 1 },
    Object.defineProperty({}, "x", {
      enumerable: true,
      get() {
        accessed = true;
        return 1;
      },
    }),
  ])
    await assert.rejects(
      h.invoke(p, { version: "json", field: "who", args: args as any }),
      /JSON/,
    );
  assert.equal(accessed, false);
  const caller = { ...p };
  const run = h.invoke(caller, { version: "json", field: "who", args: null });
  caller.tenant = "evil";
  caller.subject = "evil";
  assert.deepEqual(await run, p);
});

test("unsupported subscriptions and duplicate query/mutation names fail deployment", async () => {
  const h = new IsolateHost();
  for (const typeDefs of [
    "type Query{x:Int} type Mutation{x:Int}",
    "type Query{x:Int} type Subscription{x:Int}",
  ])
    await assert.rejects(
      h.deploy(
        p,
        "ambiguous",
        `export const typeDefs=${JSON.stringify(typeDefs)};export const schema={x:'Int'};export const resolve=()=>1`,
      ),
      /schema/,
    );
});
test("raw outbound denial has a reachable-server negative control", async () => {
  const http = await import("node:http");
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.end("reachable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    assert.equal(await (await fetch(url)).text(), "reachable");
    assert.equal(requests, 1);
    const h = new IsolateHost();
    await h.deploy(
      p,
      "network",
      `export const typeDefs='type Query{network:Boolean}';export const schema={network:'Boolean'};export async function resolve(){try{await fetch("http://127.0.0.1:" + ${(server.address() as import("node:net").AddressInfo).port});return false}catch{return true}}`,
    );
    assert.equal(
      await h.invoke(p, { version: "network", field: "network", args: null }),
      true,
    );
    assert.equal(requests, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
