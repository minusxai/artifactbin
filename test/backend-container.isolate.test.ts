import test from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../src/backend/container-host.ts";
import { withCapabilityAuthority } from "../src/backend/capability-authority.ts";
import { configureResources } from "../src/connectors/config.ts";
import type { BackendJson } from "../src/backend/contracts.ts";
const principal = { tenant: "document-a", subject: "alice" };
const scope = { owner: "backend-owner", fileId: "backend-file" };
const source = (body: string, preamble = "") =>
  `${preamble};export const typeDefs='type Query{value:String}';export default {Query:{async value(args,principal,caps){${body}}}}`;
test("real sandbox compiles and invokes unicode, owns caller input, keeps module state only while warm, denies ambient authority", async (t) => {
  const host = createBackendHost();
  t.after(async () => {
    delete process.env.PAGEGI_HOST_TEST_SECRET;
    await host.close?.();
  });
  process.env.PAGEGI_HOST_TEST_SECRET = "host-only-test-value";
  const text = "你好 🌍 café ".repeat(1000);
  const app = await host.compile(
    source(
      `counter++;let blocked=false;try{await fetch('http://example.invalid')}catch{blocked=true}let denied=false;try{await caps.invoke({tenant:'forged'})}catch{denied=true}return JSON.stringify({text:args.text,subject:principal.subject,tenant:principal.tenant,counter,blocked,denied,ambient:typeof process==='undefined'?null:process.env.PAGEGI_HOST_TEST_SECRET??null})`,
      "let counter=0",
    ),
  );
  const args = { text },
    actor = { ...principal };
  const pending = host.invoke({ deployment: app, principal: actor, input: { field: "value", args }, env: {}, reuse: { kind: "file", scope: scope } });
  args.text = "modified";
  actor.subject = "forged";
  const result = JSON.parse((await pending) as string);
  assert.deepEqual(result, {
    text,
    subject: "alice",
    tenant: "document-a",
    counter: 1,
    blocked: true,
    denied: true,
    ambient: null,
  });
  const again = async (h = host) =>
    JSON.parse((await h.invoke({ deployment: app, principal: principal, input: { field: "value", args: { text: "again" } }, env: {}, reuse: { kind: "file", scope: scope } })) as string).counter;
  // The warm sandbox keeps the module's state between calls of the same backend version…
  assert.equal(await again(), 2);
  // …and a host that has closed its sandboxes starts over.
  const fresh = createBackendHost();
  try {
    assert.equal(await again(fresh), 1);
  } finally {
    await fresh.close?.();
  }
  const unicode = await host.compile(source(`return ${JSON.stringify(text)}`));
  assert.equal(
    await host.invoke({ deployment: unicode, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    text,
  );
});
test("a warm sandbox answers the next call several times faster than the first, and a deadline fails that call alone", async (t) => {
  const host = createBackendHost({ invokeTimeoutMs: 1000 });
  t.after(() => host.close?.());
  const app = await host.compile(
    source(`if(args&&args.spin){const until=Date.now()+5000;while(Date.now()<until){}}return 'ok'`),
  );
  const timed = async (args: BackendJson) => {
    const started = performance.now();
    const value = await host.invoke({ deployment: app, principal: principal, input: { field: "value", args }, env: {}, reuse: { kind: "file", scope: scope } });
    return { value, ms: performance.now() - started };
  };
  const first = await timed(null);
  const second = await timed(null);
  assert.equal(second.value, "ok");
  assert.ok(second.ms * 3 < first.ms, `warm call ${second.ms}ms vs cold ${first.ms}ms`);
  await assert.rejects(host.invoke({ deployment: app, principal: principal, input: { field: "value", args: { spin: true } }, env: {}, reuse: { kind: "one-shot" } }), /deadline/);
  assert.equal((await timed(null)).value, "ok", "the next call runs in a new sandbox");
});
test("compiler denies filesystem imports, wrong resolver kinds and hostile module initialization", async () => {
  const host = createBackendHost({ compileTimeoutMs: 1500 });
  await assert.rejects(
    host.compile(`import x from '/etc/passwd';${source("return x")}`),
    /build_rejected/,
  );
  await assert.rejects(
    host.compile(source("return import(args.module)")),
    /build_rejected/,
  );
  await assert.rejects(
    host.compile(
      `export const typeDefs='type Query{value:String}';export default {Mutation:{value(){return 'x'}}}`,
    ),
    /schema_rejected/,
  );
  await assert.rejects(
    host.compile(source("return 'x'", "while(true){}")),
    /deadline/,
  );
  const app = await host.compile(source("return 'recovered'"));
  assert.equal(
    await host.invoke({ deployment: app, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    "recovered",
  );
});
test("hard memory kill, CPU deadline, output quotas and invalid JSON release resources and recover", async () => {
  const host = createBackendHost({ invokeTimeoutMs: 2500 });
  const memory = await host.compile(
    source(
      "const buffers=[];while(true){const b=new Uint8Array(8*1024*1024);b.fill(7);buffers.push(b)}",
    ),
  );
  await assert.rejects(
    host.invoke({ deployment: memory, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    /memory_limit/,
  );
  const cpu = await host.compile(source("while(true){}"));
  await assert.rejects(
    host.invoke({ deployment: cpu, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    /deadline/,
  );
  for (const body of [
    "return 'x'.repeat(65537)",
    "return [,,]",
    "return {get value(){return 1}}",
    "return NaN",
  ]) {
    const app = await host.compile(source(body));
    await assert.rejects(
      host.invoke({ deployment: app, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
      /output_quota|backend_rejected/,
    );
  }
  const ok = await host.compile(source("return 'after-failures'"));
  assert.equal(
    await host.invoke({ deployment: ok, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    "after-failures",
  );
});
test("cancellation during startup and execution releases concurrency slot", async () => {
  const host = createBackendHost({ maxConcurrent: 1, admitWaitMs: 50 });
  const abort = new AbortController();
  const starting = host.compile(source("return 'x'"), abort.signal);
  await assert.rejects(
    host.compile(source("return 'overload'")),
    /backend_busy/,
  );
  abort.abort();
  await assert.rejects(starting, /cancelled/);
  const app = await host.compile(source("while(true){}"));
  const controller = new AbortController();
  const pending = host.invoke(
    { deployment: app, principal: principal, input: { field: "value", args: null }, signal: controller.signal, env: {}, reuse: { kind: "one-shot" } },
  );
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    await assert.rejects(pending, /cancelled/);
  } finally {
    clearTimeout(timer);
  }
  const normal = await host.compile(source("return 'ok'"));
  assert.equal(
    await host.invoke({ deployment: normal, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    "ok",
  );
});

test("real sandbox bridges named capabilities with captured authority and transactions", async () => {
  const calls: unknown[] = [];
  const host = createBackendHost({
    capabilityHandler: async (actor, request) => {
      calls.push({ actor, request });
      return request.kind === "invoke" ? { value: "roundtrip" } : ["atomic"];
    },
  });
  const app = await host.compile(
    source(
      `const a=await caps.invoke({resource:'records',operation:'read',input:args});const b=await caps.transaction('records',[{operation:'write',input:null}]);let denied=false;try{await caps.invoke({resource:'records',operation:'read',input:null,tenant:'forged'})}catch{denied=true}return JSON.stringify({a,b,denied})`,
    ),
  );
  assert.deepEqual(
    JSON.parse(
      (await host.invoke({ deployment: app, principal: principal, input: {
        field: "value",
        args: { text: "🌍" },
      }, env: {}, reuse: { kind: "one-shot" } })) as string,
    ),
    { a: { value: "roundtrip" }, b: ["atomic"], denied: true },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual((calls[0] as any).actor, principal);
});
test("capability counts and pending work are bounded; trusted failures are sanitized", async () => {
  let calls = 0;
  const host = createBackendHost({
    capabilityHandler: async () => {
      calls++;
      return null;
    },
  });
  const app = await host.compile(
    source(
      `let denied=0;for(let i=0;i<101;i++){try{await caps.invoke({resource:'r',operation:'read',input:null})}catch{denied++}}return String(denied)`,
    ),
  );
  assert.equal(
    await host.invoke({ deployment: app, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    "1",
  );
  assert.equal(calls, 100);
  const errors = await host.compile(
    source(
      `try{await caps.invoke({resource:'r',operation:'read',input:null})}catch(e){return String(e)}return 'unexpected'`,
    ),
  );
  assert.equal(
    await host.invoke(
      { deployment: errors, principal: principal, input: { field: "value", args: null }, capabilityHandler: async () => {
        throw Error("host-only-secret");
      }, env: {}, reuse: { kind: "one-shot" } },
    ),
    "Error: capability rejected",
  );
  calls = 0;
  const concurrent = await host.compile(
    source(
      `const result=await Promise.allSettled(Array.from({length:9},()=>caps.invoke({resource:'r',operation:'read',input:null})));return String(result.filter(x=>x.status==='rejected').length)`,
    ),
  );
  assert.equal(
    await host.invoke(
      { deployment: concurrent, principal: principal, input: { field: "value", args: null }, capabilityHandler: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 30));
        return null;
      }, env: {}, reuse: { kind: "one-shot" } },
    ),
    "1",
  );
  assert.equal(calls, 8);
});
test("capability deadline and caller cancellation abort the trusted handler and recover", async (t) => {
  let begin!: () => void;
  let started = new Promise<void>((resolve) => {
    begin = resolve;
  });
  let aborted = false;
  const host = createBackendHost({
    invokeTimeoutMs: 3000,
    capabilityHandler: async (_actor, _req, signal) => {
      begin();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(Error("stopped"));
          },
          { once: true },
        ),
      );
    },
  });
  t.after(() => host.close?.());
  const app = await host.compile(
    source(
      `if(!args.wait)return 'ready';await caps.invoke({resource:'r',operation:'read',input:null});return 'unexpected'`,
    ),
  );
  const reuse = { kind: "file", scope: { owner: "test-owner", fileId: "deadline-file" } } as const;
  assert.equal(await host.invoke({ deployment: app, principal, input: { field: "value", args: { wait: false } }, env: {}, reuse }), "ready");
  const controller = new AbortController();
  const invocation = host.invoke(
    { deployment: app, principal: principal, input: { field: "value", args: { wait: true } }, signal: controller.signal, env: {}, reuse },
  );
  const cancelled = assert.rejects(invocation, /cancelled/);
  await started;
  controller.abort();
  await cancelled;
  assert.equal(aborted, true);
  aborted = false;
  started = new Promise((resolve) => {
    begin = resolve;
  });
  assert.equal(await host.invoke({ deployment: app, principal, input: { field: "value", args: { wait: false } }, env: {}, reuse }), "ready");
  const deadline = host.invoke({ deployment: app, principal: principal, input: { field: "value", args: { wait: true } }, env: {}, reuse });
  const timedOut = assert.rejects(deadline, /deadline/);
  await started;
  await timedOut;
  assert.equal(aborted, true);
  const ok = await host.compile(source(`return 'recovered'`));
  assert.equal(
    await host.invoke({ deployment: ok, principal: principal, input: { field: "value", args: { wait: true } }, env: {}, reuse }),
    "recovered",
  );
});
test("closing a real host aborts an active capability and awaits container disposal", async () => {
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  let aborted = false, releaseCleanup!: () => void;
  const handlerCleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
  const host = createBackendHost({
    capabilityHandler: async (_principal, _request, signal) => {
      started();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            void handlerCleanup.then(() => reject(Error("closed")));
          },
          { once: true },
        ),
      );
    },
  });
  const app = await host.compile(
    source(
      `await caps.invoke({resource:'r',operation:'read',input:null});return 'unexpected'`,
    ),
  );
  const invocation = host.invoke({ deployment: app, principal: principal, input: {
    field: "value",
    args: null,
  }, env: {}, reuse: { kind: "one-shot" } });
  const rejected = assert.rejects(invocation, /cancelled/);
  await active;
  const closing = host.close!();
  assert.equal(host.close!(), closing);
  let settled = false; void closing.then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(aborted, true); assert.equal(settled, false, "close awaits owned handler cleanup after abort");
  releaseCleanup();
  await closing;
  await rejected;
  assert.equal(aborted, true);
  await assert.rejects(
    host.invoke({ deployment: app, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    /backend_unavailable/,
  );
  await assert.rejects(
    host.compile(source(`return 'unexpected'`)),
    /backend_unavailable/,
  );
});

test("calls beyond maxConcurrent wait for a slot and run instead of failing busy", async (t) => {
  const host = createBackendHost({ maxConcurrent: 1 });
  t.after(() => host.close?.());
  const app = await host.compile(source("await new Promise(r=>setTimeout(r,200));return args.echo"));
  const call = (echo: string) => host.invoke({ deployment: app, principal: principal, input: { field: "value", args: { echo } }, env: {}, reuse: { kind: "one-shot" } });
  assert.deepEqual(await Promise.all([call("a"), call("b"), call("c")]), ["a", "b", "c"]);
});

test("warm module state through capability authority belongs to the trusted backend file and owner", async (t) => {
  const host = withCapabilityAuthority(
    createBackendHost({ maxConcurrent: 1, sandboxNetwork: "none" }),
    configureResources({ resources: {}, grants: [] }),
  );
  t.after(() => host.close?.());
  const app = await host.compile(source("const result=previous;previous=args.value;return result", "let previous=null"));
  const invoke = (owner: string, fileId: string, value: string, tenant = "same-page", subject: string | null = "viewer", env = {}) =>
    host.invoke({ deployment: app, principal: { tenant, subject }, input: { field: "value", args: { value } }, env: env, reuse: { kind: "file", scope: { owner, fileId } } });
  assert.equal(await invoke("owner-a", "file-a", "a1"), null);
  assert.equal(await invoke("owner-a", "file-b", "b1"), null, "identical code and env on a second file cannot read file-a");
  assert.equal(await invoke("owner-b", "file-a", "other-owner"), null, "an owner change cannot inherit module state");
  assert.equal(await invoke("owner-a", "file-a", "a2", "another-page", null), "a1", "one backend file intentionally reuses state across pages and viewers");
  assert.equal(await invoke("owner-a", "file-b", "b2"), "b1");
  assert.equal(await invoke("owner-a", "file-a", "rotated", "same-page", "viewer", { TOKEN: "new" }), null, "changed secrets start a fresh sandbox");
  const changed = await host.compile(source("const result=previous;previous=args.value;return result", "let previous=null") + "\n// new source revision");
  assert.equal(changed.bundleHash, app.bundleHash, "comment-only source revision compiles to the same bundle");
  assert.notEqual(changed.version, app.version);
  assert.equal(await host.invoke({ deployment: changed, principal: principal, input: { field: "value", args: { value: "changed" } }, env: {}, reuse: { kind: "file", scope: { owner: "owner-a", fileId: "file-a" } } }), null, "a changed version starts fresh even with the same bundle");
  assert.equal(await host.invoke({ deployment: app, principal: principal, input: { field: "value", args: { value: "one-shot-first" } }, env: {}, reuse: { kind: "one-shot" } }), null);
  assert.equal(await host.invoke({ deployment: app, principal: principal, input: { field: "value", args: { value: "one-shot-second" } }, env: {}, reuse: { kind: "one-shot" } }), null, "explicit one-shot never enables reuse");
});

test("close prevents invocations and compilation paused between open-check and admission", async () => {
  const compiler = createBackendHost({ sandboxNetwork: "none" });
  let app;
  try { app = await compiler.compile(source("return 'unexpected'")); }
  finally { await compiler.close?.(); }
  for (const kind of ["invoke", "compile"] as const) {
    const host = createBackendHost({ sandboxNetwork: "none" });
    const pending = kind === "invoke"
      ? host.invoke({ deployment: app, principal: principal, input: { field: "value", args: null }, env: {}, reuse: { kind: "one-shot" } })
      : host.compile(source("return 'unexpected'"));
    const rejected = assert.rejects(pending, /backend_unavailable|cancelled/);
    await host.close?.();
    await rejected;
  }
});
