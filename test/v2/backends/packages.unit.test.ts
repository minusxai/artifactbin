/**
 * npm imports (src/backend/packages.ts, compiler.ts): which imports a backend
 * file may write, how the execution service fetches them from esm.sh, and the
 * lockfile a deployment records. No network: every fetch is injected.
 */
import { test } from "node:test";
import { getEventListeners } from "node:events";
import assert from "node:assert/strict";
import {
  createEsmFetcher,
  esmUrl,
  importKind,
  resolvePackages,
} from "../../../src/backend/packages.ts";
import { compileBackend } from "../../../src/backend/compiler.ts";
import {
  BACKEND_RUNTIME,
  verifyDeployment,
} from "../../../src/backend/deployment.ts";
import type { ModuleFetcher } from "../../../src/backend/contracts.ts";

test("imports are the platform's, built-ins, pinned packages, unpinned packages, or refused", () => {
  const cases: [string, string][] = [
    ["@afbin/apollo", "apollo"],
    ["node:crypto", "builtin"],
    ["cloudflare:sockets", "builtin"],
    ["pg@8.13.1", "package"],
    ["@scope/pkg@1.0.0-beta.2/sub/path", "package"],
    ["pg", "unpinned"],
    ["pg@8", "unpinned"],
    ["pg@^8.13.1", "unpinned"],
    ["@scope/pkg", "unpinned"],
    ["./helper", "refused"],
    ["/etc/passwd", "refused"],
    ["https://esm.sh/pg", "refused"],
    ["pg@8.13.1/../evil@1.0.0", "refused"],
  ];
  for (const [specifier, kind] of cases)
    assert.equal(importKind(specifier), kind, specifier);
});

/** A fake esm.sh: path → [status, body, headers]. Records every URL asked for. */
function fakeEsm(
  routes: Record<string, [number, string, Record<string, string>?]>,
) {
  const asked: string[] = [];
  const fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    asked.push(url.pathname + url.search);
    const route = routes[url.pathname + url.search] ?? [404, "not found"];
    const response = new Response(route[1], {
      status: route[0],
      headers: route[2],
    });
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

test("the esm.sh fetcher follows x-esm-path to the real build, retries transient failures, and caches", async () => {
  let failures = 1;
  const esm = fakeEsm({
    "/tiny@1.0.0?target=esnext&bundle&conditions=workerd": [
      200,
      'export * from "/tiny@1.0.0/esnext/tiny.bundle.mjs";',
      { "x-esm-path": "/tiny@1.0.0/esnext/tiny.bundle.mjs" },
    ],
    "/tiny@1.0.0/esnext/tiny.bundle.mjs": [200, "export const one = 1;"],
  });
  const flaky = (async (input: string | URL, init?: RequestInit) => {
    if (failures-- > 0) return new Response("busy", { status: 503 });
    return esm.fetch(input, init);
  }) as typeof globalThis.fetch;
  const fetchModule = createEsmFetcher({ fetch: flaky, delay: async () => {} });
  const module = await fetchModule(esmUrl("tiny@1.0.0"));
  assert.deepEqual(module, {
    url: "https://esm.sh/tiny@1.0.0/esnext/tiny.bundle.mjs",
    code: "export const one = 1;",
  });
  await fetchModule(esmUrl("tiny@1.0.0"));
  assert.equal(
    esm.asked.length,
    2,
    "one fetch of the shim and one of the build; the second call is cached",
  );
});

test("the esm.sh fetcher's cache is bounded by bytes: a large module evicts older ones", async () => {
  const esm = fakeEsm({
    "/a@1.0.0/a.mjs": [200, "a".repeat(600)],
    "/b@1.0.0/b.mjs": [200, "b".repeat(600)],
  });
  const fetchModule = createEsmFetcher({ fetch: esm.fetch, cacheBytes: 1000 });
  await fetchModule("https://esm.sh/a@1.0.0/a.mjs");
  await fetchModule("https://esm.sh/b@1.0.0/b.mjs");
  await fetchModule("https://esm.sh/b@1.0.0/b.mjs");
  await fetchModule("https://esm.sh/a@1.0.0/a.mjs");
  assert.deepEqual(esm.asked, [
    "/a@1.0.0/a.mjs",
    "/b@1.0.0/b.mjs",
    "/a@1.0.0/a.mjs",
  ]);
});

test("one caller giving up never fails another caller waiting for the same module", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = (async (input: string | URL) => {
    await gate;
    const response = new Response("export const x = 1;", { status: 200 });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  }) as typeof globalThis.fetch;
  const fetchModule = createEsmFetcher({ fetch: slow });
  const quitter = new AbortController();
  const first = fetchModule("https://esm.sh/x@1.0.0/x.mjs", quitter.signal);
  const second = fetchModule(
    "https://esm.sh/x@1.0.0/x.mjs",
    AbortSignal.timeout(5000),
  );
  quitter.abort();
  await assert.rejects(first);
  release();
  assert.equal((await second).code, "export const x = 1;");
});

test("a body over the size limit is cut off while it streams, whatever content-length says", async () => {
  let pulled = 0;
  const endless = (async (input: string | URL) => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1000));
      },
    });
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  }) as typeof globalThis.fetch;
  await assert.rejects(
    createEsmFetcher({ fetch: endless, maxBytes: 5000 })(
      "https://esm.sh/x@1.0.0/x.mjs",
    ),
    /module too large/,
  );
  assert.ok(pulled < 20, `stopped after ${pulled} chunks`);
});

test("the esm.sh fetcher gives up at once on a missing package and never leaves esm.sh", async () => {
  const esm = fakeEsm({});
  const fetchModule = createEsmFetcher({
    fetch: esm.fetch,
    delay: async () => {},
  });
  await assert.rejects(fetchModule(esmUrl("missing@1.0.0")), /HTTP 404/);
  assert.equal(esm.asked.length, 1);
  await assert.rejects(
    fetchModule("https://example.com/x.js"),
    /not an esm.sh URL/,
  );
  const away = (async () => {
    const response = new Response("x", { status: 200 });
    Object.defineProperty(response, "url", {
      value: "https://evil.example/x.js",
    });
    return response;
  }) as unknown as typeof globalThis.fetch;
  await assert.rejects(
    createEsmFetcher({ fetch: away })(esmUrl("tiny@1.0.0")),
    /away from esm.sh/,
  );
});

/** A fetcher over fixed modules: requested URL → [final URL, code]. */
const fixed = (
  modules: Record<string, [string, string]>,
): ModuleFetcher & { asked: string[] } => {
  const asked: string[] = [];
  return Object.assign(
    async (url: string) => {
      asked.push(url);
      const found = modules[url];
      if (!found) throw Error("HTTP 404");
      return { url: found[0], code: found[1] };
    },
    { asked },
  );
};

const DB = {
  [esmUrl("db@1.2.3")]: [
    "https://esm.sh/db@1.2.3/X-workerd/esnext/db.bundle.mjs",
    'import { wire } from "/db-wire?target=esnext";\nimport { Buffer } from "node:buffer";\nexport const open = async () => { const { connect } = await import("/cloudflare:sockets?target=esnext"); return [wire, connect, Buffer]; };',
  ],
  "https://esm.sh/db-wire?target=esnext": [
    "https://esm.sh/db-wire@0.4.0/esnext/db-wire.mjs",
    "export const wire = 'v0.4.0';",
  ],
} satisfies Record<string, [string, string]>;

test("a pinned package is fetched with everything it imports from esm.sh, and recorded in the lockfile", async () => {
  const fetchModule = fixed(DB);
  const resolved = await resolvePackages(["db@1.2.3"], fetchModule);
  assert.deepEqual(resolved.packages, { "db@1.2.3": esmUrl("db@1.2.3") });
  assert.deepEqual(
    Object.keys(resolved.modules).sort(),
    [esmUrl("db@1.2.3"), "https://esm.sh/db-wire?target=esnext"].sort(),
  );
  assert.deepEqual(Object.keys(resolved.lockfile), [
    "db@1.2.3",
    "https://esm.sh/db-wire?target=esnext",
  ]);
  assert.equal(
    resolved.lockfile["db@1.2.3"]!.url,
    "https://esm.sh/db@1.2.3/X-workerd/esnext/db.bundle.mjs",
  );
  assert.match(
    resolved.lockfile["https://esm.sh/db-wire?target=esnext"]!.integrity,
    /^sha256-[A-Za-z0-9+/]{43}=$/,
  );
  // node:* and cloudflare:* are the runtime's: never fetched.
  assert.equal(fetchModule.asked.length, 2);
});

test("a package that cannot be loaded or bundled is refused naming it", async () => {
  await assert.rejects(resolvePackages(["gone@1.0.0"], fixed({})), {
    code: "build_rejected",
    detail:
      /npm package "gone@1.0.0" could not be loaded from esm.sh \(HTTP 404\)/,
  });
  const offsite = fixed({
    [esmUrl("leaky@1.0.0")]: [
      "https://esm.sh/leaky@1.0.0/x.mjs",
      'import "https://evil.example/x.js";',
    ],
  });
  await assert.rejects(resolvePackages(["leaky@1.0.0"], offsite), {
    detail: /"leaky@1.0.0" imports "https:\/\/evil.example\/x.js"/,
  });
  const computed = fixed({
    [esmUrl("dyn@1.0.0")]: [
      "https://esm.sh/dyn@1.0.0/x.mjs",
      "export const load = (name) => import(name);",
    ],
  });
  await assert.rejects(resolvePackages(["dyn@1.0.0"], computed), {
    detail: /"dyn@1.0.0" imports modules computed at run time/,
  });
  const big = fixed({
    [esmUrl("big@1.0.0")]: [
      "https://esm.sh/big@1.0.0/x.mjs",
      "export const x = '" + "a".repeat(2000) + "';",
    ],
  });
  await assert.rejects(
    resolvePackages(["big@1.0.0"], big, undefined, { maxBytes: 1000 }),
    { detail: /larger than/ },
  );
});

test("a package that stalls past the budget is named; a wave stops at the size limit without waiting for the rest", async () => {
  const stalled: ModuleFetcher = (url, signal) =>
    new Promise((_, reject) =>
      signal?.addEventListener("abort", () => reject(signal.reason)),
    );
  await assert.rejects(
    resolvePackages(["slow@1.0.0"], stalled, undefined, { budgetMs: 50 }),
    {
      code: "build_rejected",
      detail: /npm package "slow@1.0.0" did not load from esm.sh within 0 s/,
    },
  );
  const mixed: ModuleFetcher = (url, signal) =>
    url === esmUrl("big@1.0.0")
      ? Promise.resolve({
          url: "https://esm.sh/big@1.0.0/x.mjs",
          code: "x".repeat(2000),
        })
      : stalled(url, signal);
  const started = Date.now();
  await assert.rejects(
    resolvePackages(["big@1.0.0", "slow@1.0.0"], mixed, undefined, {
      maxBytes: 1000,
      budgetMs: 5000,
    }),
    {
      detail: /larger than .* \(at "big@1.0.0"\)/,
    },
  );
  assert.ok(Date.now() - started < 1000);
});

const SOURCE = `import { open } from 'db@1.2.3';
export const typeDefs = 'type Query { n: Int }';
export default { Query: { n: async () => (await open()).length } };`;
const compiled = {
  bundle: "bundle",
  runtime: BACKEND_RUNTIME,
  metadata: {
    typeDefs: "type Query { n: Int }",
    fields: ["n"],
    roots: { Query: ["n"], Mutation: [] },
  },
};

test("compilation sends the fetched modules to the sandbox and seals the lockfile into the deployment", async () => {
  let request: any;
  const deployment = await compileBackend(
    SOURCE,
    async (r) => ((request = r), compiled),
    undefined,
    fixed(DB),
  );
  assert.equal(request.kind, "compile");
  assert.deepEqual(request.packages, { "db@1.2.3": esmUrl("db@1.2.3") });
  assert.equal(Object.keys(request.modules).length, 2);
  assert.deepEqual(Object.keys(deployment.lockfile), [
    "db@1.2.3",
    "https://esm.sh/db-wire?target=esnext",
  ]);
  verifyDeployment(deployment);
  // A deployment must carry a well-formed lockfile.
  const { lockfile: _, ...without } = deployment;
  assert.throws(
    () => verifyDeployment(without as typeof deployment),
    /deployment_invalid/,
  );
  assert.throws(
    () =>
      verifyDeployment({
        ...deployment,
        lockfile: {
          "db@1.2.3": { url: "https://evil.example/x", integrity: "sha256-x" },
        },
      }),
    /deployment_invalid/,
  );
  // A file without packages records an empty lockfile and fetches nothing.
  const plain = await compileBackend(
    "export const typeDefs = 'type Query { n: Int }';",
    async () => compiled,
  );
  assert.deepEqual(plain.lockfile, {});
});

test("an unpinned import, or a package on a host without a fetcher, is refused before the sandbox runs", async () => {
  let ran = false;
  const run = async () => ((ran = true), compiled);
  await assert.rejects(
    compileBackend(
      "import pg from 'pg';\n" + SOURCE,
      run,
      undefined,
      fixed(DB),
    ),
    {
      code: "build_rejected",
      detail: /pin "pg" to an exact version, such as "pg@1.2.3"/,
    },
  );
  await assert.rejects(compileBackend(SOURCE, run), {
    detail: /npm imports are not available/,
  });
  assert.equal(ran, false);
});

test("closing the package client aborts and drains shared fetch work despite caller cancellation", async () => {
  let started!: () => void, cleanup!: () => void;
  const beginning = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finishing = new Promise<void>((resolve) => {
    cleanup = resolve;
  });
  let fetchSignal: AbortSignal | undefined;
  const fetchModule = createEsmFetcher({
    fetch: (async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      fetchSignal = signal;
      started();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            void finishing.then(() => reject(Error("closed")));
          },
          { once: true },
        );
      });
      throw Error("unreachable");
    }) as typeof fetch,
  });
  const caller = new AbortController();
  const pending = fetchModule(esmUrl("close-probe@1.0.0"), caller.signal);
  const rejected = assert.rejects(pending);
  await beginning;
  caller.abort();
  await rejected;
  assert.equal(
    fetchSignal?.aborted,
    false,
    "one caller cannot cancel a shared fetch",
  );
  let closed = false;
  const closing = fetchModule.close().then(() => {
    closed = true;
  });
  assert.equal(fetchSignal?.aborted, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  cleanup();
  await closing;
  assert.equal(fetchModule.close(), fetchModule.close());
  await assert.rejects(fetchModule(esmUrl("close-probe@1.0.0")));
});

function manualTiming() {
  let now = 0;
  const tasks = new Map<symbol, { at: number; run: () => void }>();
  return {
    now: () => now,
    after(ms: number, run: () => void) {
      const id = Symbol();
      tasks.set(id, { at: now + ms, run });
      return () => {
        tasks.delete(id);
      };
    },
    advance(ms: number) {
      now += ms;
      for (const [id, task] of tasks)
        if (task.at <= now) {
          tasks.delete(id);
          task.run();
        }
    },
  };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("shared pending work has one global bounded admission budget", async () => {
  const releases: Array<() => void> = [];
  let active = 0,
    peak = 0,
    calls = 0;
  const client = createEsmFetcher({
    maxConcurrent: 1,
    maxPending: 2,
    fetch: (async () => {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return new Response("export default 1");
    }) as typeof fetch,
  });
  const a = client(esmUrl("a@1.0.0")),
    duplicate = client(esmUrl("a@1.0.0"));
  const b = client(esmUrl("b@1.0.0"));
  // A transient condition, never the author's build failing.
  const refused = assert.rejects(client(esmUrl("c@1.0.0")), { code: "backend_busy" });
  await turn();
  assert.equal(calls, 1);
  releases.shift()!();
  await Promise.all([a, duplicate]);
  await turn();
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  releases.shift()!();
  await b;
  await refused;
  await client.close();
});

test("a busy package fetcher fails the graph as busy, never as the author's build", async () => {
  const { BackendHostError } = await import("../../../src/backend/contracts.ts");
  await assert.rejects(
    resolvePackages(["a@1.0.0"], async () => {
      throw new BackendHostError("backend_busy");
    }),
    { code: "backend_busy" },
  );
});

test("cache expiry and graph deadlines use the injected scheduler", async () => {
  const timing = manualTiming();
  let calls = 0;
  const client = createEsmFetcher({
    timing,
    fetch: (async () => {
      calls++;
      return new Response("export default 1");
    }) as typeof fetch,
  });
  await client(esmUrl("a@1.0.0"));
  timing.advance(3599999);
  await client(esmUrl("a@1.0.0"));
  assert.equal(calls, 1);
  timing.advance(1);
  await client(esmUrl("a@1.0.0"));
  assert.equal(calls, 2);
  const graph = resolvePackages(
    ["never@1.0.0"],
    () => new Promise(() => {}),
    undefined,
    { timing, budgetMs: 10 },
  );
  const failure = assert.rejects(
    graph,
    (error: any) =>
      error.code === "build_rejected" && /within/.test(error.detail),
  );
  timing.advance(10);
  await failure;
  await client.close();
});

test("graph waves admit only bounded module work", async () => {
  const release: Array<() => void> = [];
  let active = 0,
    peak = 0;
  const graph = resolvePackages(
    ["a@1.0.0", "b@1.0.0", "c@1.0.0"],
    async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => release.push(resolve));
      active--;
      return { url, code: "export default 1" };
    },
    undefined,
    { maxConcurrent: 1 },
  );
  await turn();
  assert.equal(peak, 1);
  for (let i = 0; i < 3; i++) {
    release.shift()!();
    await turn();
  }
  assert.equal(Object.keys((await graph).modules).length, 3);
});

test("retry waits and shared load deadlines are deterministic and close drains queued work", async () => {
  const timing = manualTiming();
  let calls = 0;
  const client = createEsmFetcher({
    timing,
    timeoutMs: 1000,
    maxConcurrent: 1,
    maxPending: 2,
    fetch: (async (_url, init) => {
      calls++;
      if (calls === 1) return new Response("busy", { status: 503 });
      await new Promise<void>((_, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
      throw Error("unreachable");
    }) as typeof fetch,
  });
  const first = client(esmUrl("a@1.0.0"));
  const firstFailure = assert.rejects(first, /deadline/);
  await turn();
  assert.equal(calls, 1);
  timing.advance(249);
  await turn();
  assert.equal(calls, 1);
  timing.advance(1);
  await turn();
  assert.equal(calls, 2);
  timing.advance(750);
  await firstFailure;
  const active = client(esmUrl("b@1.0.0")),
    queued = client(esmUrl("c@1.0.0"));
  const failures = Promise.all([
    assert.rejects(active),
    assert.rejects(queued),
  ]);
  await client.close();
  await failures;
  assert.equal(calls, 3, "queued URL never starts transport after close");
});

test("a queued load's deadline starts with its own fetch, and an aborted active load drains before close", async () => {
  const timing = manualTiming();
  let cleanup!: () => void,
    calls = 0;
  const release: Array<() => void> = [];
  const client = createEsmFetcher({
    timing,
    timeoutMs: 10,
    maxConcurrent: 1,
    maxPending: 2,
    fetch: (async (url, init) => {
      calls++;
      if (String(url).includes("/b@")) {
        await new Promise<void>((resolve) => release.push(resolve));
        return new Response("export default 1");
      }
      await new Promise<void>((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => {
            cleanup = () => reject(Error("drained"));
          },
          { once: true },
        );
      });
      throw Error("unreachable");
    }) as typeof fetch,
  });
  const active = client(esmUrl("a@1.0.0"));
  const activeFailure = assert.rejects(active);
  const queued = client(esmUrl("b@1.0.0"));
  timing.advance(10);
  await turn();
  assert.equal(calls, 1, "the queued load has not started while the active one drains");
  cleanup();
  await activeFailure;
  await turn();
  assert.equal(calls, 2);
  timing.advance(9);
  release.shift()!();
  assert.equal((await queued).code, "export default 1");
  const stalled = client(esmUrl("c@1.0.0"));
  const stalledFailure = assert.rejects(stalled);
  await turn();
  let closed = false;
  const closing = client.close().then(() => {
    closed = true;
  });
  await turn();
  assert.equal(closed, false);
  cleanup();
  await stalledFailure;
  await closing;
});

test("a permanent failure answers at once even when the response body stalls on cancel", async () => {
  const stalled = (status: number, headers: Record<string, string> = {}, url?: string) =>
    (async (input: string | URL) => {
      const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel: () => new Promise(() => {}) });
      const response = new Response(body, { status, headers });
      Object.defineProperty(response, "url", { value: url ?? String(input) });
      return response;
    }) as typeof globalThis.fetch;
  const within = <T>(work: Promise<T>) =>
    Promise.race([work, new Promise<never>((_r, reject) => setTimeout(() => reject(Error("waited for the body")), 1000))]);
  const cases: [typeof globalThis.fetch, RegExp][] = [
    [stalled(404), /HTTP 404/],
    [stalled(200, { "content-length": "999999" }), /module too large/],
    [stalled(200, {}, "https://evil.example/x.js"), /away from esm.sh/],
  ];
  for (const [fetch, expected] of cases) {
    const fetchModule = createEsmFetcher({ fetch, maxBytes: 1000, delay: async () => {} });
    await assert.rejects(within(fetchModule(esmUrl("tiny@1.0.0"))), expected);
    void fetchModule.close();
  }
  let pulled = 0;
  const endless = (async (input: string | URL) => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(1000)); },
      cancel: () => new Promise(() => {}),
    });
    const response = new Response(body, { status: 200 });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  }) as typeof globalThis.fetch;
  await assert.rejects(within(createEsmFetcher({ fetch: endless, maxBytes: 5000 })(esmUrl("tiny@1.0.0"))), /module too large/);
});

test("many retries waiting at once share one close listener, and close ends their waits", async () => {
  // Every AbortSignal that gains an abort listener while the retries wait.
  const targets = new Set<EventTarget>();
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    if (type === "abort") targets.add(this);
    return (add as (...args: unknown[]) => void).call(this, type, ...rest);
  } as typeof add;
  try {
    const busy = createEsmFetcher({ fetch: (async () => new Response("busy", { status: 503 })) as typeof globalThis.fetch });
    const urls = Array.from({ length: 24 }, (_, i) => `https://esm.sh/m${i}@1.0.0/m.mjs`);
    const waiting = Promise.allSettled(urls.map((url) => busy(url)));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const most = Math.max(...[...targets].map((target) => getEventListeners(target, "abort").length));
    assert.ok(most <= 2, `${most} abort listeners on one signal while 24 retries wait`);
    const started = Date.now();
    await busy.close();
    const results = await waiting;
    assert.ok(results.every((r) => r.status === "rejected"));
    assert.ok(Date.now() - started < 200, "close ends the waits instead of letting them run out");
  } finally {
    EventTarget.prototype.addEventListener = add;
  }
});
