/**
 * Publish and save at their limits (references/http-api.md "Publishing" and
 * "Saving"): backend files past the size limit are 413, a backend that cannot
 * be compiled now is 503 and publishes nothing, every If-Match form is read
 * exactly and a malformed one never saves, and two publishes racing for one
 * reserved backend ID publish exactly one page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublishResponse, SourceResponse } from "../../../src/server/af-api-contracts.ts";
import { BackendHostError, type BackendHost } from "../../../src/backend/contracts.ts";
import { page, startServer, type TestServer } from "../support/server.ts";
import { compileOnlyHost } from "../support/todo.ts";

const BACKEND = "import { gql } from '@afbin/apollo';\nexport const typeDefs = gql`type Query { ok: Boolean! }`;\nexport default { Query: { ok: () => true } };\n";
const link = (id: string) => `  <link rel="af-backend" href="https://artifactbin.dev/af/v1/ids/${id}" data-af-name="api">\n`;

async function reserve(server: TestServer, token: string, key: string, count = 1): Promise<string[]> {
  const response = await server.request("/api/ids", { token, body: { count }, headers: { "Idempotency-Key": key } });
  assert.equal(response.status, 201);
  return ((await response.json()) as { ids: string[] }).ids;
}
async function publish(server: TestServer, token: string, body: Record<string, unknown>) {
  const response = await server.request("/api/publish", { token, body });
  return { status: response.status, body: (await response.json()) as PublishResponse & { error?: string } };
}
async function pathCount(server: TestServer, token: string): Promise<number> {
  return ((await (await server.request("/api/paths", { token })).json()) as { entries: unknown[] }).entries.length;
}
function failingCompiler(error: () => Error): BackendHost {
  return {
    async compile() {
      throw error();
    },
    async invoke() {
      throw new BackendHostError("backend_unavailable");
    },
  };
}

test("backend files past 4,000,000 characters in total are 413 before compiling, one past its own quota is 422, and a page source past the limit is 422", async () => {
  let compiled = 0;
  const host = compileOnlyHost();
  const server = await startServer({
    backendHost: {
      compile: (source, signal) => {
        compiled++;
        return host.compile(source, signal);
      },
      invoke: host.invoke,
    },
  });
  try {
    const token = await server.token();
    const [a, b] = await reserve(server, token, "limits-two", 2);
    const half = BACKEND + "// " + "x".repeat(2_100_000) + "\n";
    const tooLarge = await publish(server, token, {
      source: page("<p>big</p>", link(a!) + link(b!)),
      files: { [a!]: half, [b!]: half },
      requestId: "limits-413",
    });
    assert.equal(tooLarge.status, 413, tooLarge.body.error);
    assert.match(tooLarge.body.error ?? "", /too large/);
    assert.equal(compiled, 0, "nothing was compiled");
    const overQuota = await publish(server, token, {
      source: page("<p>one big file</p>", link(a!)),
      files: { [a!]: BACKEND + "// " + "x".repeat(300_000) + "\n" },
      requestId: "limits-quota",
    });
    assert.equal(overQuota.status, 422, overQuota.body.error);
    assert.match(overQuota.body.error ?? "", new RegExp(`${a}.*source_quota`), "the file past its own 256 KiB quota is named");
    const fits = await publish(server, token, {
      source: page("<p>fits</p>", link(a!)),
      files: { [a!]: BACKEND + "// " + "x".repeat(200_000) + "\n" },
      requestId: "limits-fits",
    });
    assert.equal(fits.status, 201, fits.body.error);
    const bigPage = await publish(server, token, { source: page("<p>" + "y".repeat(4_000_001) + "</p>"), requestId: "limits-page" });
    assert.equal(bigPage.status, 422);
    assert.match(bigPage.body.error ?? "", /4,000,000/);
    assert.equal(await pathCount(server, token), 1);
  } finally {
    await server.close();
  }
});

test("a backend that cannot be compiled now is 503 with nothing published; a rejected one is 422 naming the file", async () => {
  let error: () => Error = () => new BackendHostError("backend_unavailable");
  const server = await startServer({ backendHost: failingCompiler(() => error()) });
  try {
    const token = await server.token();
    const [id] = await reserve(server, token, "limits-503");
    const body = (requestId: string) => ({ source: page("<p>api</p>", link(id!)), files: { [id!]: BACKEND }, requestId });
    for (const code of ["backend_unavailable", "backend_busy"] as const) {
      error = () => new BackendHostError(code);
      const refused = await publish(server, token, body("limits-" + code));
      assert.equal(refused.status, 503, code);
      assert.match(refused.body.error ?? "", /could not be compiled now/, code);
    }
    error = () => Object.assign(new Error("export default is missing"), { fileId: id, code: "invalid_backend" });
    const rejected = await publish(server, token, body("limits-422"));
    assert.equal(rejected.status, 422);
    assert.match(rejected.body.error ?? "", new RegExp(`${id}.*export default is missing`));
    assert.equal(await pathCount(server, token), 0, "no page was published by the failed attempts");
    const stillReserved = await publish(server, await server.token(), { source: page("<p>x</p>", link(id!)), files: { [id!]: BACKEND }, requestId: "limits-stranger" });
    assert.equal(stillReserved.status, 422, "the ID stays the reserver's");
  } finally {
    await server.close();
  }
});

test("If-Match is read as a bare, quoted or weak version; anything else never saves and leaves the head alone", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    const published = await publish(server, token, { source: page("<p>v1</p>"), requestId: "limits-if-match" });
    assert.equal(published.status, 201);
    const id = published.body.id;
    const save = (ifMatch: string | undefined, text: string) =>
      server.request(`/api/files/${id}/source`, {
        method: "PUT",
        token,
        body: { source: page(`<p>${text}</p>`) },
        headers: ifMatch === undefined ? {} : { "If-Match": ifMatch },
      });
    const head = async () => ((await (await server.request(`/api/files/${id}/source`, { token })).json()) as SourceResponse).version;
    assert.equal((await save("1", "two")).status, 200);
    assert.equal((await save('"2"', "three")).status, 200);
    assert.equal((await save('W/"3"', "four")).status, 200);
    assert.equal((await save(" 4 ", "five")).status, 200, "surrounding whitespace is trimmed");
    assert.equal(await head(), 5);
    assert.equal((await save(undefined, "six")).status, 428);
    assert.equal((await save("", "six")).status, 428, "an empty header is a missing one");
    for (const malformed of ["abc", "0", "-5", "5.0", "5 extra", "05", '"', "99999999999"]) {
      const response = await save(malformed, "six");
      assert.ok(response.status === 409 || response.status === 428, `${JSON.stringify(malformed)} answered ${response.status}`);
      assert.equal(await head(), 5, `${JSON.stringify(malformed)} saved nothing`);
    }
    assert.equal((await save("5", "six")).status, 200, "the real version still saves");
    assert.equal(await head(), 6);
  } finally {
    await server.close();
  }
});

test("two publishes racing for one reserved backend ID publish exactly one page; afterwards the ID links as an existing backend", async () => {
  const server = await startServer({ backendHost: compileOnlyHost() });
  try {
    const token = await server.token();
    const [id] = await reserve(server, token, "limits-race");
    const attempt = (requestId: string) =>
      publish(server, token, { source: page(`<p>${requestId}</p>`, link(id!)), files: { [id!]: BACKEND }, requestId });
    const results = await Promise.all([attempt("race-a"), attempt("race-b"), attempt("race-c")]);
    const won = results.filter((r) => r.status === 201);
    assert.equal(won.length, 1, results.map((r) => `${r.status} ${r.body.error ?? ""}`).join(" | "));
    for (const lost of results.filter((r) => r.status !== 201)) {
      assert.ok(lost.status === 409 || lost.status === 422, String(lost.status));
      assert.match(lost.body.error ?? "", new RegExp(id!), "the refusal names the ID");
    }
    assert.equal(await pathCount(server, token), 1, "the race published one page");
    const later = await attempt("race-d");
    assert.equal(later.status, 201, "once published, the backend is linked by later pages like any existing backend");
    assert.notEqual(later.body.id, won[0]!.body.id);
    assert.equal(await pathCount(server, token), 2);
    for (const pageId of [won[0]!.body.id, later.body.id]) {
      const backends = (await (await server.request(`/api/files/${pageId}/backends`, { token })).json()) as { backends: { id: string }[] };
      assert.deepEqual(backends.backends.map((b) => b.id), [id], pageId);
    }
  } finally {
    await server.close();
  }
});
