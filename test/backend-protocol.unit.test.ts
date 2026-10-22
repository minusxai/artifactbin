import test from "node:test";
import assert from "node:assert/strict";
import { createSandboxCall } from "../src/backend/sandbox-protocol.ts";
import type {
  BackendCapabilityHandler,
  BackendJson,
} from "../src/backend/contracts.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const frame = (value: unknown) => Buffer.from(JSON.stringify(value));
const request = { kind: "store", operation: "get" };
function fixture(handler?: BackendCapabilityHandler) {
  const replies: BackendJson[] = [],
    values: BackendJson[] = [],
    errors: string[] = [];
  const abort = new AbortController();
  const call = createSandboxCall({
    principal: { tenant: "page", subject: null },
    handler,
    signal: abort.signal,
    reply: (value) => {
      replies.push(value);
    },
    result: (value) => {
      values.push(value);
    },
    failure: (error) => {
      errors.push(error.code);
    },
  });
  return { call, replies, values, errors, abort };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
test("protocol validates frames before dispatch and denies duplicate capability ids", async () => {
  let calls = 0;
  const pending = deferred<BackendJson>();
  const f = fixture(async () => {
    calls++;
    return pending.promise;
  });
  f.call.receive(frame({ kind: "capability", id: 1, request }));
  await flush();
  assert.equal(calls, 1);
  f.call.receive(frame({ kind: "capability", id: 1, request }));
  assert.deepEqual(f.errors, ["backend_rejected"]);
  pending.resolve(null);
  await flush();
  assert.deepEqual(f.replies, []);
  for (const malformed of [
    { kind: "capability", id: 1, request, principal: {} },
    { kind: "capability", id: 1, request: { ...request, fileId: "forged" } },
  ]) {
    const g = fixture(async () => {
      calls++;
      return null;
    });
    g.call.receive(frame(malformed));
    await flush();
    assert.deepEqual(g.errors, ["backend_rejected"]);
  }
  assert.equal(calls, 1);
});
test("protocol refuses a terminal result while capability work is pending", async () => {
  const pending = deferred<BackendJson>();
  const f = fixture(() => pending.promise);
  f.call.receive(frame({ kind: "capability", id: 1, request }));
  f.call.receive(frame({ kind: "result", ok: true, value: "early" }));
  assert.deepEqual(f.errors, ["backend_rejected"]);
  assert.deepEqual(f.values, []);
  pending.resolve(null);
  await flush();
  assert.deepEqual(f.replies, []);
});
test("protocol sanitizes capability errors, suppresses late replies and enforces result quota", async () => {
  const f = fixture(async () => {
    throw Error("private transport detail");
  });
  f.call.receive(frame({ kind: "capability", id: 1, request }));
  await flush();
  assert.deepEqual(f.replies, [
    {
      kind: "capability-result",
      id: 1,
      ok: false,
      code: "capability_rejected",
      outcome: "unknown",
    },
  ]);
  f.call.receive(frame({ kind: "result", ok: true, value: "done" }));
  assert.deepEqual(f.values, ["done"]);
  const g = fixture();
  g.call.receive(frame({ kind: "result", ok: true, value: "x".repeat(65537) }));
  assert.deepEqual(g.errors, ["output_quota"]);
  const pending = deferred<BackendJson>();
  const h = fixture(() => pending.promise);
  h.call.receive(frame({ kind: "capability", id: 1, request }));
  await flush();
  h.call.close();
  pending.resolve("late");
  await flush();
  assert.deepEqual(h.replies, []);
});
test("protocol bounds pending and total capability calls at their exact limits", async () => {
  const pending = deferred<BackendJson>();
  let dispatched = 0;
  const f = fixture(async () => {
    dispatched++;
    return pending.promise;
  });
  for (let id = 1; id <= 8; id++)
    f.call.receive(frame({ kind: "capability", id, request }));
  await flush();
  assert.equal(dispatched, 8);
  assert.deepEqual(f.errors, []);
  f.call.receive(frame({ kind: "capability", id: 9, request }));
  assert.deepEqual(f.errors, ["backend_rejected"]);
  pending.resolve(null);
  await flush();
  assert.deepEqual(f.replies, []);
  const g = fixture(async () => null);
  for (let id = 1; id <= 100; id++) {
    g.call.receive(frame({ kind: "capability", id, request }));
    await flush();
  }
  assert.equal(g.replies.length, 100);
  assert.deepEqual(g.errors, []);
  g.call.receive(frame({ kind: "capability", id: 101, request }));
  assert.deepEqual(g.errors, ["backend_rejected"]);
});
test("protocol enforces per-request and aggregate request budgets before trusted dispatch", async () => {
  const sized = (bytes: number) => {
    const empty = { kind: "store", operation: "set", expected: 0, value: "" };
    return {
      ...empty,
      value: "x".repeat(bytes - Buffer.byteLength(JSON.stringify(empty))),
    };
  };
  for (const bytes of [65536, 65537]) {
    let dispatched = 0;
    const f = fixture(async () => {
      dispatched++;
      return null;
    });
    f.call.receive(frame({ kind: "capability", id: 1, request: sized(bytes) }));
    await flush();
    assert.equal(dispatched, bytes === 65536 ? 1 : 0);
    assert.deepEqual(f.errors, bytes === 65536 ? [] : ["backend_rejected"]);
  }
  let dispatched = 0;
  const f = fixture(async () => {
    dispatched++;
    return null;
  });
  for (let id = 1; id <= 16; id++) {
    f.call.receive(frame({ kind: "capability", id, request: sized(65536) }));
    await flush();
  }
  assert.equal(dispatched, 16);
  assert.deepEqual(f.errors, []);
  f.call.receive(frame({ kind: "capability", id: 17, request }));
  await flush();
  assert.equal(dispatched, 16);
  assert.deepEqual(f.errors, ["backend_rejected"]);
});
test("protocol sanitizes per-response and aggregate response overflows without exposing payloads", async () => {
  for (const size of [65534, 65535]) {
    const f = fixture(async () => "x".repeat(size));
    f.call.receive(frame({ kind: "capability", id: 1, request }));
    await flush();
    assert.equal((f.replies[0] as { ok: boolean }).ok, size === 65534);
  }
  const f = fixture(async () => "x".repeat(65534));
  for (let id = 1; id <= 17; id++) {
    f.call.receive(frame({ kind: "capability", id, request }));
    await flush();
  }
  assert.equal((f.replies[15] as { ok: boolean }).ok, true);
  assert.deepEqual(f.replies[16], {
    kind: "capability-result",
    id: 17,
    ok: false,
    code: "capability_rejected",
    outcome: "unknown",
  });
});
test("protocol bounds raw and aggregate bytes and rejects malformed UTF-8", async () => {
  for (const [raw, error] of [
    [Buffer.from([0xff]), "backend_rejected"],
    [Buffer.alloc(1500001, 32), "output_quota"],
  ] as const) {
    const f = fixture();
    f.call.receive(raw);
    assert.deepEqual(f.errors, [error]);
  }
  const f = fixture(async () => null);
  for (let id = 1; id <= 2; id++) {
    const data = frame({ kind: "capability", id, request });
    f.call.receive(
      Buffer.concat([data, Buffer.alloc(1499999 - data.length, 32)]),
    );
    await flush();
  }
  assert.deepEqual(f.errors, []);
  assert.equal(f.replies.length, 2);
  f.call.receive(frame({ kind: "capability", id: 3, request }));
  assert.deepEqual(f.errors, ["output_quota"]);
});
test("close or abort before queued dispatch prevents calling the trusted handler", async () => {
  for (const mode of ["close", "abort"]) {
    let dispatched = 0;
    const f = fixture(async () => {
      dispatched++;
      return null;
    });
    f.call.receive(frame({ kind: "capability", id: 1, request }));
    if (mode === "close") f.call.close();
    else f.abort.abort();
    await flush();
    assert.equal(dispatched, 0);
    assert.deepEqual(f.replies, []);
  }
});
test("protocol close aborts and drains actual handler cleanup before sharing completion", async () => {
  const entered = deferred<void>(),
    cleanup = deferred<BackendJson>();
  let signal!: AbortSignal;
  const f = fixture(async (_actor, _request, owned) => {
    signal = owned;
    entered.resolve();
    return cleanup.promise;
  });
  f.call.receive(frame({ kind: "capability", id: 1, request }));
  await entered.promise;
  let drained = false;
  const closing = f.call.close();
  assert.equal(f.call.close(), closing);
  void closing.then(() => {
    drained = true;
  });
  assert.equal(signal.aborted, true);
  await flush();
  assert.equal(drained, false);
  cleanup.resolve("late");
  await closing;
  assert.equal(drained, true);
  assert.deepEqual(f.replies, []);
});
test("protocol caller abort keeps drain pending until rejected handler cleanup settles", async () => {
  const entered = deferred<void>(),
    cleanup = deferred<void>();
  let signal!: AbortSignal;
  const f = fixture(async (_actor, _request, owned) => {
    signal = owned;
    entered.resolve();
    await cleanup.promise;
    throw Error("cleanup finished with failure");
  });
  f.call.receive(frame({ kind: "capability", id: 1, request }));
  await entered.promise;
  f.abort.abort();
  assert.equal(signal.aborted, true);
  let drained = false;
  const closing = f.call.close().then(() => {
    drained = true;
  });
  await flush();
  assert.equal(drained, false);
  cleanup.resolve();
  await closing;
  assert.deepEqual(f.replies, []);
});
test("validated capability domains preserve captured principal and JSON payloads", async () => {
  const received: unknown[] = [];
  const f = fixture(async (actor, request) => {
    received.push({ actor, request });
    return null;
  });
  const requests = [
    { kind: "store", operation: "get" },
    { kind: "invoke", resource: "records", operation: "read", input: false },
    { kind: "invoke", resource: "records", operation: "read", input: 0 },
    {
      kind: "invoke",
      resource: "records",
      operation: "read",
      input: { nested: [null, true, 3] },
    },
    {
      kind: "transaction",
      resource: "records",
      operations: [{ operation: "read", input: null }],
    },
    { kind: "store", operation: "set", expected: 0, value: { saved: true } },
  ];
  for (const [index, request] of requests.entries()) {
    f.call.receive(frame({ kind: "capability", id: index + 1, request }));
    await flush();
  }
  assert.deepEqual(
    received,
    requests.map((request) => ({
      actor: { tenant: "page", subject: null },
      request,
    })),
  );
  await f.call.close();
});
test("only trusted dataset_changed capability errors cross the sandbox boundary; forged raw codes are scrubbed", async () => {
  const { BackendDatasetChangedError } = await import(
    "../src/backend/contracts.ts"
  );
  for (const trusted of [true, false]) {
    const f = fixture(async () => {
      throw trusted
        ? new BackendDatasetChangedError()
        : Object.assign(Error("private detail"), { code: "dataset_changed" });
    });
    f.call.receive(
      frame({
        kind: "capability",
        id: 1,
        request: {
          kind: "dataset",
          operation: "read",
          input: {
            binding: "data",
            schema: "public",
            table: "rows",
            offset: 0,
            limit: 1,
          },
        },
      }),
    );
    await flush();
    const reply = f.replies[0] as { code?: string };
    assert.equal(
      reply.code,
      trusted ? "dataset_changed" : "capability_rejected",
    );
    assert.equal(JSON.stringify(f.replies).includes("private detail"), false);
    await f.call.close();
  }
});
