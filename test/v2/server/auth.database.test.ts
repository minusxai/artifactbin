import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../support/server.ts";

test("a test harness can mint a token for an agent when test login is on", async () => {
  const server = await startServer();
  try {
    const response = await server.request("/api/auth/test-token", { body: { email: "agent@example.test" } });
    assert.equal(response.status, 200);
    const { token, username } = (await response.json()) as { token: string; username: string };
    assert.ok(token.length >= 32);
    assert.ok(username);
    const paths = await server.request("/api/paths", { token });
    assert.equal(paths.status, 200, "the token works on the API");
    assert.deepEqual(await paths.json(), { entries: [] });
  } finally {
    await server.close();
  }
});

test("test login is off unless enabled", async () => {
  const server = await startServer({ testLogin: false });
  try {
    const response = await server.request("/api/auth/test-token", { body: { email: "agent@example.test" } });
    assert.equal(response.status, 404);
  } finally {
    await server.close();
  }
});

test("the documented email-code sign-in still returns { token, username }", async () => {
  const codes: { to: string; code: string }[] = [];
  const server = await startServer({
    sendCode: async (message) => {
      codes.push(message);
    },
  });
  try {
    const request = await server.request("/api/auth/email/request", { body: { email: "author@example.test" } });
    assert.equal(request.status, 200);
    assert.equal(codes.length, 1);
    const verify = await server.request("/api/auth/email/verify", {
      body: { email: "author@example.test", code: codes[0]!.code },
    });
    assert.equal(verify.status, 200);
    const body = (await verify.json()) as { token: string; username: string };
    assert.ok(body.token);
    assert.ok(body.username);
  } finally {
    await server.close();
  }
});

test("the old CLI-era routes are gone", async () => {
  const server = await startServer();
  try {
    const token = await server.token();
    for (const [path, method] of [
      ["/api/pair", "POST"],
      ["/api/pair/publish", "POST"],
      ["/api/files/Pg4mQ2/backend/deploy", "POST"],
      ["/d/abcdefghijkl", "GET"],
    ] as const) {
      const response = await server.request(path, { method, token, ...(method === "POST" ? { body: {} } : {}) });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  } finally {
    await server.close();
  }
});
