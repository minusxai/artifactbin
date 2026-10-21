/**
 * The lambda sandbox's contract (skills/pagegi-author/references/backend.md,
 * "Secrets" and "Packages and the network"), on the real image: the owner's
 * secrets arrive as `env` and nowhere else, private addresses are refused,
 * and a pinned npm package is bundled in. No test here needs the internet:
 * packages come from an injected fetcher. PAGEGI_TEST_INTERNET=1 adds one
 * that fetches a real package from esm.sh and calls a public https address.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import { esmUrl } from "../../../src/backend/packages.ts";
import type { ModuleFetcher } from "../../../src/backend/contracts.ts";

const principal = { tenant: "Pg4mQ2", subject: null };

test("a resolver reads the owner's secrets from env, never from process.env, and a sandbox serves one env only", async (t) => {
  const host = createBackendHost({});
  t.after(() => host.close?.());
  const app = await host.compile(`
export const typeDefs = 'type Query { probe: String! }';
const atStart = Object.keys(process.env).length;
export default { Query: { probe: (_a, _p, _c, env) => JSON.stringify({
  key: env.API_KEY ?? null,
  names: Object.keys(env),
  frozen: Object.isFrozen(env),
  processEnv: Object.keys(process.env).length + atStart,
}) } };`);
  const call = async (env: Record<string, string>) =>
    JSON.parse((await host.invoke({ deployment: app, principal: principal, input: { field: "probe", args: null }, env: env, reuse: { kind: "one-shot" } })) as string);
  assert.deepEqual(await call({ API_KEY: "owner-a", OTHER: "x" }), {
    key: "owner-a",
    names: ["API_KEY", "OTHER"],
    frozen: true,
    processEnv: 0,
  });
  // The same bundle for another owner (or after a secret changed) never sees the first env.
  assert.deepEqual(await call({ API_KEY: "owner-b" }), { key: "owner-b", names: ["API_KEY"], frozen: true, processEnv: 0 });
  assert.deepEqual(await call({}), { key: null, names: [], frozen: true, processEnv: 0 });
  await assert.rejects(
    host.invoke({ deployment: app, principal: principal, input: { field: "probe", args: null }, env: { "bad name": "x" }, reuse: { kind: "one-shot" } }),
    /input_quota/,
  );
});

test("fetch and connect() to private, local and metadata addresses are refused at once", async (t) => {
  const host = createBackendHost({});
  t.after(() => host.close?.());
  const app = await host.compile(`
import { connect } from 'cloudflare:sockets';
export const typeDefs = 'type Query { reach(target: String!, tcp: Boolean!): String! }';
export default { Query: { async reach({ target, tcp }) {
  const started = Date.now();
  try {
    if (tcp) { const socket = connect(target); await socket.opened; socket.close(); }
    else await fetch(target, { signal: AbortSignal.timeout(4000) });
    return 'reached';
  } catch { return Date.now() - started < 1000 ? 'refused' : 'timed out'; }
} } };`);
  const reach = (target: string, tcp = false) =>
    host.invoke({ deployment: app, principal: principal, input: { field: "reach", args: { target, tcp } }, env: {}, reuse: { kind: "one-shot" } });
  for (const target of ["http://10.0.0.1/", "http://172.17.0.1/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8787/", "http://localhost/"])
    assert.equal(await reach(target), "refused", target);
  for (const target of ["10.0.0.1:5432", "127.0.0.1:5432"]) assert.equal(await reach(target, true), "refused", target);
});

test("a pinned npm package is fetched at compile time, recorded in the lockfile, and bundled in", async (t) => {
  const asked: string[] = [];
  const fetchModule: ModuleFetcher = async (url) => {
    asked.push(url);
    if (url === esmUrl("tiny-greet@1.0.0"))
      return {
        url: "https://esm.sh/tiny-greet@1.0.0/X-d29ya2VyZA/esnext/tiny-greet.bundle.mjs",
        code: 'import { Buffer } from "node:buffer";\nexport const greet = async (name) => { const { connect } = await import("/cloudflare:sockets?conditions=workerd&target=esnext"); return Buffer.from("hello " + name).toString() + (typeof connect); };',
      };
    throw Error("HTTP 404");
  };
  const host = createBackendHost({ fetchModule: Object.assign(fetchModule, { close: async () => {} }) });
  t.after(() => host.close?.());
  const app = await host.compile(`
import { greet } from 'tiny-greet@1.0.0';
export const typeDefs = 'type Query { hello(name: String!): String! }';
export default { Query: { hello: ({ name }) => greet(name) } };`);
  assert.deepEqual(asked, [esmUrl("tiny-greet@1.0.0")]);
  assert.deepEqual(Object.keys(app.lockfile), ["tiny-greet@1.0.0"]);
  assert.equal(app.lockfile["tiny-greet@1.0.0"]!.url, "https://esm.sh/tiny-greet@1.0.0/X-d29ya2VyZA/esnext/tiny-greet.bundle.mjs");
  assert.equal(await host.invoke({ deployment: app, principal: principal, input: { field: "hello", args: { name: "ann" } }, env: {}, reuse: { kind: "one-shot" } }), "hello annfunction");
  await assert.rejects(
    host.compile("import x from 'missing-pkg@1.0.0';\nexport const typeDefs = 'type Query { n: Int }';\nexport default { Query: { n: () => x } };"),
    { code: "build_rejected", detail: /npm package "missing-pkg@1.0.0" could not be loaded from esm.sh \(HTTP 404\)/ },
  );
});

test("with the internet: a real package from esm.sh compiles and https reaches a public address", { skip: process.env.PAGEGI_TEST_INTERNET !== "1" }, async (t) => {
  const host = createBackendHost({});
  t.after(() => host.close?.());
  const app = await host.compile(`
import postgres from 'postgres@3.4.5';
import { connect } from 'cloudflare:sockets';
export const typeDefs = 'type Query { probe: String! }';
export default { Query: { async probe() {
  const response = await fetch('https://example.com/');
  // What a database driver's TLS upgrade does (postgres' ssl option): plain TCP, then startTls().
  const plain = connect('example.com:443', { secureTransport: 'starttls' });
  const socket = plain.startTls();
  const writer = socket.writable.getWriter();
  await writer.write(new TextEncoder().encode('GET / HTTP/1.0\\r\\nHost: example.com\\r\\n\\r\\n'));
  const { value } = await socket.readable.getReader().read();
  socket.close();
  return typeof postgres + ' ' + response.status + ' ' + new TextDecoder().decode(value).split('\\r\\n')[0];
} } };`);
  assert.match(app.lockfile["postgres@3.4.5"]!.url, /^https:\/\/esm\.sh\/postgres@3\.4\.5\//);
  assert.match(String(await host.invoke({ deployment: app, principal: principal, input: { field: "probe", args: null }, env: {}, reuse: { kind: "one-shot" } })), /^function 200 HTTP\/1\.[01] 200 OK$/);
});
