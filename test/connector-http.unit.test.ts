import test from "node:test";
import assert from "node:assert/strict";
import { destination, invokeHttp } from "../src/connectors/http.ts";
import { ConnectorError } from "../src/connectors/json.ts";
import type {
  HttpBinding,
  HttpOperation,
} from "../src/connectors/contracts.ts";

const binding: HttpBinding = {
  kind: "http",
  origin: "https://example.test",
  token: "transport-secret",
  operations: {},
};
const operation: HttpOperation = { method: "POST", path: "/submit?key=value" };
const caller = { tenant: "tenant", subject: "subject", grants: [] };
const outcome = (code: string, value: string) => (error: unknown) =>
  error instanceof ConnectorError &&
  error.code === code &&
  error.outcome === value;

test("HTTP destination pins authority, credentials, fragment and POST policy before dispatch", () => {
  assert.equal(
    destination(binding, operation, false).href,
    "https://example.test/submit?key=value",
  );
  for (const origin of [
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test?q=1",
    "https://example.test/#fragment",
  ])
    assert.throws(
      () => destination({ ...binding, origin }, operation, false),
      outcome("INVALID", "not-executed"),
    );
  for (const path of [
    "https://elsewhere.test/submit",
    "//elsewhere.test/submit",
    "https://user:pass@example.test/submit",
    "/submit#fragment",
  ])
    assert.throws(
      () => destination(binding, { ...operation, path }, false),
      outcome("INVALID", "not-executed"),
    );
  assert.throws(
    () =>
      destination(binding, { ...operation, method: "GET" as "POST" }, false),
    outcome("INVALID", "not-executed"),
  );
  for (const host of ["127.0.0.1", "[::1]", "localhost"]) {
    const local = { ...binding, origin: `http://${host}:1234` };
    assert.throws(
      () => destination(local, operation, false),
      outcome("INVALID", "not-executed"),
    );
    assert.equal(destination(local, operation, true).hostname, host);
  }
  assert.throws(
    () =>
      destination({ ...binding, origin: "http://127.0.0.2" }, operation, true),
    outcome("INVALID", "not-executed"),
  );
});

test("HTTP validation and pre-abort never dispatch; accepted request binds trusted identity, secret and signal", async (t) => {
  let sent = 0,
    dispatched = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    sent++;
    assert.equal(dispatched, 1);
    assert.equal(url.href, "https://example.test/submit?key=value");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, {
      "content-type": "application/json",
      authorization: "Bearer transport-secret",
    });
    assert.deepEqual(JSON.parse(String(init.body)), {
      caller: { tenant: "tenant", subject: "subject" },
      input: { subject: "untrusted" },
    });
    return new Response('{"ok":true}');
  });
  const invoke = (maxBytes = 1024, signal = controller.signal) =>
    invokeHttp(
      binding,
      operation,
      caller,
      { subject: "untrusted" },
      signal,
      maxBytes,
      false,
      () => dispatched++,
    );
  await assert.rejects(invoke(1), outcome("INVALID", "not-executed"));
  const aborted = new AbortController();
  aborted.abort(Error("already aborted"));
  await assert.rejects(invoke(1024, aborted.signal), /already aborted/);
  assert.equal(sent, 0);
  assert.equal(dispatched, 0);
  assert.deepEqual(await invoke(), { ok: true });
  assert.equal(sent, 1);
  assert.equal(dispatched, 1);
});

test("HTTP rejected and over-limit streamed responses are cancelled with unknown outcome, never retried", async (t) => {
  for (const scenario of [
    "http-error",
    "too-large",
    "invalid-json",
    "bodyless",
  ] as const) {
    let cancels = 0,
      calls = 0,
      dispatched = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            scenario === "too-large" ? "x".repeat(1025) : "not-json",
          ),
        );
      },
      cancel() {
        cancels++;
      },
    });
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      if (scenario === "bodyless") return new Response(null);
      if (scenario === "invalid-json") return new Response("not-json");
      return new Response(body, {
        status: scenario === "http-error" ? 503 : 200,
      });
    });
    await assert.rejects(
      invokeHttp(
        binding,
        operation,
        caller,
        {},
        new AbortController().signal,
        1024,
        false,
        () => dispatched++,
      ),
      outcome(scenario === "http-error" ? "UNAVAILABLE" : "INVALID", "unknown"),
    );
    assert.equal(calls, 1);
    assert.equal(dispatched, 1);
    if (scenario === "http-error" || scenario === "too-large")
      assert.equal(cancels, 1, scenario);
    t.mock.restoreAll();
  }
});
