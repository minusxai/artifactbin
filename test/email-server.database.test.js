import { testDatabase } from "./postgres.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server.js";
test("email code delivers, survives restart, grants identity once, disables passwords", async () => {
  const dbOptions = await testDatabase();
  let delivered;
  let service;
  const start = async () => {
    service = createService({
      ...dbOptions,
      allowPasswordLogin: false,
      sendCode: async (m) => {
        delivered = m;
      },
    });
    await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  };
  const stop = async () => {
    await new Promise((r) => service.server.close(r));
    await service.close();
  };
  const post = async (path, body) => {
    const r = await fetch(
      `http://127.0.0.1:${service.server.address().port}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: r.status, ...(await r.json()) };
  };
  try {
    await start();
    assert.equal(
      (await post("/api/auth/email/request", { email: " Person@example.com " }))
        .status,
      200,
    );
    assert.equal(delivered.to, "person@example.com");
    assert.match(delivered.code, /^\d{6}$/);
    assert.equal((await post("/api/login", {})).status, 404);
    assert.equal(
      (await post("/api/auth/email/request", { email: delivered.to })).status,
      429,
    );
    await stop();
    await start();
    assert.equal(
      (
        await post("/api/auth/email/verify", {
          email: delivered.to,
          code: "wrong",
        })
      ).status,
      401,
    );
    const login = await post("/api/auth/email/verify", {
      email: delivered.to,
      code: delivered.code,
    });
    assert.equal(login.status, 200);
    assert.equal(login.username, delivered.to);
    assert.ok(login.token);
    assert.equal(
      (
        await post("/api/auth/email/verify", {
          email: delivered.to,
          code: delivered.code,
        })
      ).status,
      401,
    );
    await post("/api/auth/email/request", { email: "race@example.com" });
    const raceCode = delivered.code;
    const attempts = await Promise.all(
      [1, 2].map(() =>
        post("/api/auth/email/verify", {
          email: "race@example.com",
          code: raceCode,
        }),
      ),
    );
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 401]);
  } finally {
    await stop();
    await dbOptions.cleanup();
  }
});
