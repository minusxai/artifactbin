import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server.js";
import { testDatabase } from "./postgres.js";

test("request syntax and exact endpoint paths fail before authorization or mutations", async () => {
  const db = await testDatabase();
  const service = createService(db);
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  const origin = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  try {
    const malformed = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"broken":',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: "Invalid JSON request body",
    });
    const nonobject = await fetch(origin + "/api/login", {
      method: "POST",
      body: "[]",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(nonobject.status, 400);
    assert.deepEqual(await nonobject.json(), {
      error: "JSON request body must be an object",
    });
    // Valid nested comment paths accept their own method, never a collection method.
    for (const [path, method] of [
      ["comments/item", "GET"],
      ["comments/item", "POST"],
      ["comments", "PUT"],
      ["context", "GET"],
      ["source", "POST"],
    ]) {
      const result = await fetch(origin + "/api/files/Pg4mQ2/" + path, {
        method,
        ...(method !== "GET" ? { body: "{}" } : {}),
      });
      assert.equal(result.status, 404, `${method} ${path}`);
    }
    for (const path of [
      "/api/files/Pg4mQ2/source/extra",
      "/api/files/Pg4mQ2/backend/head",
      "/api/files/Pg4mQ2/sources",
      "/api/files/abcdefghijkl/source",
      "/af/v1/ids/Pg4mQ2/extra",
    ]) {
      const result = await fetch(origin + path);
      assert.equal(result.status, 404, path);
      assert.deepEqual(await result.json(), { error: "Not found" });
    }
    const repeated = await fetch(origin + "/api//files/Pg4mQ2/source");
    assert.equal(repeated.status, 404);
  } finally {
    service.server.closeAllConnections();
    await new Promise<void>((resolve) => service.server.close(() => resolve()));
    await service.close();
    await db.cleanup();
  }
});
