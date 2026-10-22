import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createService } from "../src/server.js";
import { createBackendHost } from "../src/backend/container-host.ts";
import { testDatabase } from "./postgres.js";

// One real core/runner + V8/store + authenticated live transport boundary. The
// authored page has no timer, polling, one-shot query, refetch, or cache patch.
test("backend watchers follow cross-viewer commits and reconnect, and stop after disposal or lost access", async () => {
  const db = await testDatabase();
  const backendHost = createBackendHost();
  const codes = new Map();
  const service = createService({
    ...db,
    backendHost,
    allowPasswordLogin: false,
    sendCode: async ({ to, code }) => codes.set(to, code),
  });
  let browser;
  try {
    await new Promise((resolve) =>
      service.server.listen(0, "127.0.0.1", resolve),
    );
    const origin = `http://127.0.0.1:${service.server.address().port}`;
    async function request(path, { token, body, method, headers } = {}) {
      const response = await fetch(origin + path, {
        method: method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    async function identity(email) {
      assert.equal(
        (await request("/api/auth/email/request", { body: { email } })).status,
        200,
      );
      const signedIn = await request("/api/auth/email/verify", {
        body: { email, code: codes.get(email) },
      });
      assert.equal(signedIn.status, 200);
      return signedIn.body.token;
    }
    const owner = await identity("watch-owner@example.test");
    const reader = await identity("watch-reader@example.test");
    const reserved = await request("/api/ids", {
      token: owner,
      body: { count: 1 },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    assert.equal(reserved.status, 201);
    const backendId = reserved.body.ids[0];
    const backend = `
      export const typeDefs = 'type Query { count: Int! doubled: Int! } type Mutation { increment: Int! @auth(signedIn: true) }';
      async function count(caps) { return (await caps.store.get()).value?.count ?? 0; }
      export default {
        Query: { count: (_args, _principal, caps) => count(caps), doubled: async (_args, _principal, caps) => 2 * await count(caps) },
        Mutation: { async increment(_args, _principal, caps) {
          for (let attempt = 0; attempt < 20; attempt++) {
            const { value, version } = await caps.store.get();
            const next = (value?.count ?? 0) + 1;
            try { await caps.store.set({ count: next }, { expected: version }); return next; }
            catch (error) { if (error.code !== 'conflict') throw error; }
          }
          throw Error('Busy');
        } },
      };
    `;
    const source = `<!doctype html><html><head>
      <script src="${origin}/af/v1/core.js"></script><title>Shared watcher boundary</title>
      <link rel="af-backend" href="${origin}/af/v1/ids/${backendId}" data-af-name="shared">
      </head><body><h1>Shared watcher boundary</h1>
      <output id="count">Pending</output><output id="doubled">Pending</output>
      <output id="mutation"></output><output id="error"></output>
      <button id="increment">Increment</button><button id="dispose">Stop watching</button>
      <script type="module">
        import { gql, client } from '@afbin/apollo';
        function show(id) { return ({ data, errors }) => {
          document.querySelector('#error').textContent = errors?.map(error => error.message).join('; ') ?? '';
          if (data.shared) document.querySelector('#' + id).textContent = String(data.shared[id]);
        }; }
        try {
          const count = client.watchQuery({ query: gql\`{ shared { count } }\` }).subscribe(show('count'));
          const doubled = client.watchQuery({ query: gql\`{ shared { doubled } }\` }).subscribe(show('doubled'));
          document.querySelector('#dispose').onclick = () => { count.unsubscribe(); doubled.unsubscribe(); };
        } catch (error) { document.querySelector('#error').textContent = error.message; }
        document.querySelector('#increment').onclick = async () => {
          const result = await client.mutate({ mutation: gql\`mutation { shared { increment } }\` });
          document.querySelector('#mutation').textContent = result.errors ? JSON.stringify(result.errors) : String(result.data.shared.increment);
        };
      </script></body></html>`;
    assert.doesNotMatch(
      source,
      /setInterval|setTimeout|refetch|client\.query\(|updateQuery/,
    );
    const publication = await request("/api/publish", {
      token: owner,
      body: {
        source,
        files: { [backendId]: backend },
        requestId: crypto.randomUUID(),
        visibility: "private",
        linkRole: "viewer",
      },
    });
    assert.equal(publication.status, 201, JSON.stringify(publication.body));
    const id = publication.body.id;
    async function sharing(change) {
      const current = await request(`/api/files/${id}/sharing`, {
        token: owner,
      });
      assert.equal(current.status, 200);
      const changed = await request(`/api/files/${id}/sharing`, {
        token: owner,
        method: "PUT",
        headers: { "If-Match": String(current.body.policy.version) },
        body: change,
      });
      assert.equal(changed.status, 200);
    }
    await sharing({ email: "watch-reader@example.test", role: "viewer" });
    browser = await chromium.launch();
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
    ]);
    const pages = [];
    for (const [index, token] of [owner, reader].entries()) {
      await contexts[index].addCookies([
        {
          name: "pagegi_account",
          value: token,
          url: origin,
          httpOnly: true,
          sameSite: "Strict",
        },
      ]);
      const page = await contexts[index].newPage();
      page.setDefaultTimeout(15000);
      pages.push(page);
    }
    const [writer, observer] = pages;
    let disconnected = false;
    let observerSocket;
    const changedWaiters = new Set();
    function nextObserverChange() {
      return new Promise((resolve, reject) => {
        const done = () => {
          clearTimeout(timeout);
          changedWaiters.delete(done);
          resolve();
        };
        const timeout = setTimeout(() => {
          changedWaiters.delete(done);
          reject(Error("No authorized server change notification"));
        }, 15000);
        changedWaiters.add(done);
      });
    }
    await observer.routeWebSocket("**", (socket) => {
      if (disconnected) {
        void socket.close();
        return;
      }
      const server = socket.connectToServer();
      observerSocket = { page: socket, server };
      server.onMessage((message) => {
        socket.send(message);
        if (JSON.parse(message.toString()).type === "changed")
          for (const done of [...changedWaiters]) done();
      });
    });
    const app = (page) => page.frameLocator("#pg-frame");
    async function values(page, count) {
      // Inspect the watcher result rather than a local state mirror or mutation result.
      await app(page).locator(`#count:text-is("${count}")`).waitFor();
      await app(page)
        .locator(`#doubled:text-is("${count * 2}")`)
        .waitFor();
      assert.equal(await app(page).locator("#error").textContent(), "");
    }
    await Promise.all(pages.map((page) => page.goto(`${origin}/a/${id}`)));
    await Promise.all(pages.map((page) => values(page, 0)));
    await app(writer).locator("#increment").click();
    await Promise.all(pages.map((page) => values(page, 1)));
    await Promise.all(
      pages.map((page) => app(page).locator("#increment").click()),
    );
    await Promise.all(pages.map((page) => values(page, 3)));

    // An offline viewer misses the next commit; reconnect must invalidate its
    // active queries without authored code knowing the transport disconnected.
    disconnected = true;
    assert.ok(observerSocket, "observer has a real authorized live connection");
    await Promise.all([
      observerSocket.page.close(),
      observerSocket.server.close(),
    ]);
    await app(writer).locator("#increment").click();
    await values(writer, 4);
    disconnected = false;
    await values(observer, 4);
    await observer.reload();
    await values(observer, 4);

    let observerQueries = 0;
    observer.on("request", (request) => {
      if (request.url().endsWith("/graphql")) observerQueries++;
    });
    await app(observer).locator("#dispose").click();
    const before = observerQueries;
    const notifiedAfterDisposal = nextObserverChange();
    await app(writer).locator("#increment").click();
    await values(writer, 5);
    // Prove the server notification reached this connection before checking
    // disposal, rather than waiting less than an outbox-consumer interval.
    await notifiedAfterDisposal;
    await observer.waitForTimeout(100);
    assert.equal(
      observerQueries,
      before,
      "unsubscribed watchers must not refetch after another viewer commits",
    );
    await values(observer, 4);

    await observer.reload();
    await values(observer, 5);
    const disclosedAfterRevocation = [];
    observer.on("response", async (response) => {
      if (!response.url().endsWith("/graphql") || response.status() !== 200)
        return;
      const result = await response.json().catch(() => null);
      if (result?.data?.shared)
        disclosedAfterRevocation.push(result.data.shared);
    });
    await sharing({ email: "watch-reader@example.test", role: null });
    const denied = await request(`/api/files/${id}/graphql`, {
      token: reader,
      body: { query: "{ shared { count } }" },
    });
    assert.equal(
      denied.status,
      403,
      "account request cannot bypass a revoked page grant",
    );
    await app(writer).locator("#increment").click();
    await values(writer, 6);
    await observer.waitForTimeout(300);
    assert.ok(
      disclosedAfterRevocation.every(
        (result) => result.count !== 6 && result.doubled !== 12,
      ),
      "a revoked live watcher must never receive the subsequent private value",
    );
    const response = await observer.goto(`${origin}/a/${id}`);
    assert.ok(
      [401, 403, 404].includes(response.status()),
      "revoked observer cannot restore its watcher by reloading",
    );
  } finally {
    await browser?.close();
    service.server.closeAllConnections();
    await new Promise((resolve) => service.server.close(resolve));
    await service.close();
    await backendHost.close?.();
    await db.cleanup();
  }
});
