import test from "node:test";
import assert from "node:assert/strict";
import type { LibraryFetcher } from "../src/library-client/contracts.ts";
import {
  createLibraryTransport,
  UNREACHABLE,
} from "../src/library-client/transport.ts";
const respond = (status: number, body: string, type = "application/json") =>
  (async () => new Response(body, { status, headers: { "Content-Type": type } })) as LibraryFetcher;
// Waits for its signal; the timer keeps the test's event loop alive meanwhile.
const hangs = ((_: unknown, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    const alive = setTimeout(() => {}, 5000);
    init.signal!.addEventListener("abort", () => {
      clearTimeout(alive);
      reject(init.signal!.reason);
    });
  })) as LibraryFetcher;
const call = (fetcher: LibraryFetcher, signal = new AbortController().signal, timeoutMs?: number) =>
  createLibraryTransport(fetcher, timeoutMs)("/api/library", undefined, signal, null);
test("a proxy's HTML error page, a dropped connection and a timeout read as one plain sentence", async () => {
  await assert.rejects(call(respond(502, "<html>502</html>", "text/html")), (error: any) => {
    assert.equal(error.message, UNREACHABLE);
    assert.equal(error.status, 502);
    return true;
  });
  await assert.rejects(call(respond(200, "<html>ok</html>", "text/html")), { message: UNREACHABLE });
  await assert.rejects(
    call((async () => {
      throw new TypeError("Failed to fetch");
    }) as LibraryFetcher),
    { message: UNREACHABLE },
  );
  await assert.rejects(call(hangs, undefined, 5), { message: UNREACHABLE });
  assert.equal(UNREACHABLE, "Could not reach artifactbin. Check your connection and try again.");
});
test("the server's own JSON errors keep their words and status; a caller's abort stays an abort", async () => {
  await assert.rejects(call(respond(409, JSON.stringify({ error: "That path already exists." }))), (error: any) => {
    assert.equal(error.message, "That path already exists.");
    assert.equal(error.status, 409);
    return true;
  });
  await assert.rejects(call(respond(401, JSON.stringify({ error: "Sign in required" }))), { status: 401 });
  assert.deepEqual(await call(respond(200, JSON.stringify({ username: "a" }))), { username: "a" });
  const controller = new AbortController();
  const pending = call(hangs, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
