import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createExecutionService,
  remoteBackendHost,
} from "../src/backend/execution-service.ts";
import {
  BackendHostError,
  BackendStoreLimitError,
  type BackendHost,
} from "../src/backend/contracts.ts";
const secret = "a".repeat(48);
const principal = { tenant: "t", subject: "s" };
async function fixture(host: BackendHost, options = {}) {
  const server = createServer(
    createExecutionService({ host, secret, ...options }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return {
    client: remoteBackendHost({
      endpoint: `http://127.0.0.1:${address.port}/v1/execute`,
      secret,
    }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
test("remote execution brokers capabilities with authenticated principal", async () => {
  const f = await fixture({
    compile: async () => {
      throw Error();
    },
    invoke: async ({ deployment: _d, principal: p, input: _i, signal: s, capabilityHandler: cap }) =>
      cap!(
        p,
        { kind: "invoke", resource: "db", operation: "read", input: null },
        s!,
      ),
  });
  try {
    assert.deepEqual(
      await f.client.invoke(
        { deployment: {} as never, principal: principal, input: { field: "x", args: null }, capabilityHandler: async (p, r) => ({ subject: p.subject, operation: r.kind }), env: {}, reuse: { kind: "one-shot" } },
      ),
      { subject: "s", operation: "invoke" },
    );
  } finally {
    await f.close();
  }
});
test("deadlines abort host work and release concurrency", async () => {
  let aborted = 0;
  const f = await fixture(
    {
      compile: async (_s, signal) =>
        new Promise((_r, reject) =>
          signal!.addEventListener("abort", () => {
            aborted++;
            reject(Error());
          }),
        ),
      invoke: async () => null,
    },
    { deadlineMs: 25, maxConcurrent: 1 },
  );
  try {
    await assert.rejects(f.client.compile("x"));
    await assert.rejects(f.client.compile("x"));
    assert.equal(aborted, 2);
  } finally {
    await f.close();
  }
});
test("transport requires strong secrets and exact endpoints", () => {
  assert.throws(() =>
    remoteBackendHost({ endpoint: "http://localhost/elsewhere", secret }),
  );
  assert.throws(() =>
    remoteBackendHost({
      endpoint: "http://localhost/v1/execute",
      secret: "weak",
    }),
  );
});

test("wrong authentication never reaches the host", async () => {
  let calls = 0;
  const server = createServer(
    createExecutionService({
      secret,
      host: {
        compile: async () => {
          calls++;
          throw Error();
        },
        invoke: async () => null,
      },
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const client = remoteBackendHost({
      endpoint: `http://127.0.0.1:${port}/v1/execute`,
      secret: "b".repeat(48),
    });
    await assert.rejects(client.compile("source"));
    assert.equal(calls, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("client cancellation aborts service work and capability handlers", async () => {
  let abortHost!: () => void;
  const aborted = new Promise<void>((r) => {
    abortHost = r;
  });
  const f = await fixture({
    compile: async () => {
      throw Error();
    },
    invoke: async ({ deployment: _d, principal: p, input: _i, signal: s, capabilityHandler: cap }) => {
      s!.addEventListener("abort", abortHost, { once: true });
      return cap!(
        p,
        { kind: "invoke", resource: "db", operation: "read", input: null },
        s!,
      );
    },
  });
  const controller = new AbortController();
  let handlerStarted!: () => void;
  const started = new Promise<void>((r) => {
    handlerStarted = r;
  });
  try {
    const result = f.client.invoke(
      { deployment: {} as never, principal: principal, input: { field: "x", args: null }, signal: controller.signal, capabilityHandler: async (_p, _r, s) => {
        handlerStarted();
        return new Promise((_r, reject) =>
          s.addEventListener("abort", () => reject(Error()), { once: true }),
        );
      }, env: {}, reuse: { kind: "one-shot" } },
    );
    await started;
    controller.abort();
    await assert.rejects(result);
    await aborted;
  } finally {
    await f.close();
  }
});

test("Unix socket transport supports auth, capability roundtrip, abort and cleanup", async () => {
  const { mkdtemp, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(join(tmpdir(), "pg-exec-"));
  const socketPath = join(directory, "exec.sock");
  let cancelled!: () => void;
  const stopped = new Promise<void>((r) => {
    cancelled = r;
  });
  const host: BackendHost = {
    compile: async () => {
      throw Error();
    },
    invoke: async ({ deployment: _d, principal: p, input: i, signal: s, capabilityHandler: cap }) => {
      if (i.field === "wait")
        return new Promise((_r, reject) =>
          s!.addEventListener(
            "abort",
            () => {
              cancelled();
              reject(Error());
            },
            { once: true },
          ),
        );
      return cap!(
        p,
        { kind: "invoke", resource: "db", operation: "read", input: null },
        s!,
      );
    },
  };
  const server = createServer(createExecutionService({ host, secret }));
  await new Promise<void>((r) => server.listen(socketPath, r));
  try {
    const client = remoteBackendHost({ socketPath, secret });
    assert.equal(
      await client.invoke(
        { deployment: {} as never, principal: principal, input: { field: "read", args: null }, capabilityHandler: async () => 42, env: {}, reuse: { kind: "one-shot" } },
      ),
      42,
    );
    await assert.rejects(
      remoteBackendHost({ socketPath, secret: "b".repeat(48) }).compile("x"),
    );
    const controller = new AbortController();
    const result = client.invoke(
      { deployment: {} as never, principal: principal, input: { field: "wait", args: null }, signal: controller.signal, env: {}, reuse: { kind: "one-shot" } },
    );
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(result);
    await stopped;
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await assert.rejects(access(socketPath));
    await rm(directory, { recursive: true, force: true });
  }
});

async function scriptedExecution(
  write: (res: import("node:http").ServerResponse) => void,
  handler: import("../src/backend/contracts.ts").BackendCapabilityHandler,
) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    write(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    return await remoteBackendHost({
      endpoint: `http://127.0.0.1:${port}/v1/execute`,
      secret,
      deadlineMs: 200,
    }).invoke(
      { deployment: {} as never, principal: principal, input: { field: "x", args: null }, capabilityHandler: handler, env: {}, reuse: { kind: "one-shot" } },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
function capabilityFrame(id: number) {
  return (
    JSON.stringify({
      kind: "capability",
      id,
      request: {
        kind: "invoke",
        resource: "db",
        operation: "write",
        input: null,
      },
    }) + "\n"
  );
}
for (const id of [0, -1, 1.5])
  test(`invalid capability id ${id} never dispatches`, async () => {
    let calls = 0;
    await assert.rejects(
      scriptedExecution(
        (res) => res.write(capabilityFrame(id)),
        async () => {
          calls++;
          return null;
        },
      ),
    );
    assert.equal(calls, 0);
  });
test("duplicate capability id closes transport without replaying mutation and aborts handlers", async () => {
  let calls = 0,
    aborted = false;
  await assert.rejects(
    scriptedExecution(
      (res) => {
        res.write(capabilityFrame(1));
        setTimeout(() => res.write(capabilityFrame(1)), 10);
      },
      async (_p, _r, signal) => {
        calls++;
        return new Promise((_r, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(Error());
            },
            { once: true },
          ),
        );
      },
    ),
  );
  assert.equal(calls, 1);
  assert.equal(aborted, true);
});
test("ninth concurrent capability is rejected and aborts all eight running handlers", async () => {
  let calls = 0,
    aborted = 0;
  await assert.rejects(
    scriptedExecution(
      (res) => {
        for (let id = 1; id <= 8; id++) res.write(capabilityFrame(id));
        setTimeout(() => res.write(capabilityFrame(9)), 10);
      },
      async (_p, _r, signal) => {
        calls++;
        return new Promise((_r, reject) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted++;
              reject(Error());
            },
            { once: true },
          ),
        );
      },
    ),
  );
  assert.equal(calls, 8);
  assert.equal(aborted, 8);
});
test("malformed UTF-8 never reaches capability handlers", async () => {
  let calls = 0;
  await assert.rejects(
    scriptedExecution(
      (res) => {
        const line = capabilityFrame(1).replace('"db"', '"INVALID"');
        const parts = line.split("INVALID");
        res.write(
          Buffer.concat([
            Buffer.from(parts[0]!),
            Buffer.from([0xc3, 0x28]),
            Buffer.from(parts[1]!),
          ]),
        );
      },
      async () => {
        calls++;
        return null;
      },
    ),
  );
  assert.equal(calls, 0);
});

test("service close aborts owned work, waits cleanup, closes host once and rejects admission", async () => {
  let release!: () => void,
    started!: () => void,
    aborted = false,
    hostClosed = 0;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const host: BackendHost = {
    compile: async (_s, signal) => {
      started();
      await new Promise<void>((r) => {
        release = r;
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
      });
      throw Error();
    },
    invoke: async () => null,
    close: async () => {
      hostClosed++;
    },
  };
  const service = createExecutionService({ host, secret });
  const server = createServer(service);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const client = remoteBackendHost({
    endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`,
    secret,
  });
  try {
    const result = client.compile("x");
    void result.catch(() => {});
    await ready;
    const closing = service.close();
    assert.equal(service.close(), closing);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(aborted, true);
    assert.equal(closed, false);
    await assert.rejects(client.compile("new"));
    release();
    await closing;
    await assert.rejects(result);
    assert.equal(hostClosed, 1);
  } finally {
    await client.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("remote close aborts handler, waits its cleanup, rejects new work and is idempotent", async () => {
  let started!: () => void,
    release!: () => void,
    aborted = false;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const f = await fixture({
    compile: async () => {
      throw Error();
    },
    invoke: async ({ deployment: _d, principal: p, input: _i, signal: s, capabilityHandler: cap }) =>
      cap!(
        p,
        { kind: "invoke", resource: "db", operation: "read", input: null },
        s!,
      ),
  });
  try {
    const result = f.client.invoke(
      { deployment: {} as never, principal: principal, input: { field: "x", args: null }, capabilityHandler: async (_p, _r, signal) => {
        started();
        await new Promise<void>((r) => {
          release = r;
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
            },
            { once: true },
          );
        });
        return null;
      }, env: {}, reuse: { kind: "one-shot" } },
    );
    void result.catch(() => {});
    await ready;
    const closing = f.client.close();
    assert.equal(f.client.close(), closing);
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(aborted, true);
    assert.equal(closed, false);
    await assert.rejects(f.client.compile("new"));
    release();
    await closing;
    await assert.rejects(result);
  } finally {
    await f.close();
  }
});

test("remote close cancels active compile transport and rejects new invocations", async () => {
  let started!: () => void, aborted!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const stopped = new Promise<void>((r) => {
    aborted = r;
  });
  const f = await fixture({
    compile: async (_s, signal) => {
      started();
      return new Promise((_r, reject) =>
        signal!.addEventListener(
          "abort",
          () => {
            aborted();
            reject(Error());
          },
          { once: true },
        ),
      );
    },
    invoke: async () => null,
  });
  try {
    const result = f.client.compile("source");
    void result.catch(() => {});
    await ready;
    await f.client.close();
    await assert.rejects(result);
    await stopped;
    await assert.rejects(
      f.client.invoke({ deployment: {} as never, principal: principal, input: { field: "x", args: null }, env: {}, reuse: { kind: "one-shot" } }),
    );
  } finally {
    await f.close();
  }
});

test("a failure's bounded detail and a store_limit from the app's handler cross the execution transport", async () => {
  let storeCode: string | undefined;
  const f = await fixture({
    compile: async () => {
      throw new BackendHostError("backend_rejected", "boom at checkout\nstack line");
    },
    invoke: async ({ deployment: _d, principal: p, input: _i, signal: s, capabilityHandler: cap }) => {
      try {
        await cap!(p, { kind: "store", operation: "set", value: {}, expected: 0 }, s!);
      } catch (error) {
        storeCode = (error as { code?: string }).code;
      }
      throw new BackendHostError("store_limit", "The store document is limited to 60 KB of JSON");
    },
  });
  try {
    await assert.rejects(f.client.compile("x"), (error: BackendHostError) => {
      assert.equal(error.code, "backend_rejected");
      assert.equal(error.detail, "boom at checkout");
      return true;
    });
    await assert.rejects(
      f.client.invoke({ deployment: {} as never, principal: principal, input: { field: "x", args: null }, capabilityHandler: async () => {
        throw new BackendStoreLimitError();
      }, env: {}, reuse: { kind: "one-shot" } }),
      (error: BackendHostError) => {
        assert.equal(error.code, "store_limit");
        assert.equal(error.detail, "The store document is limited to 60 KB of JSON");
        return true;
      },
    );
    assert.equal(storeCode, "store_limit", "the service-side handler saw the store_limit code");
  } finally {
    await f.close();
  }
});

test("remote invoke carries the backend owner's env to the service's host unchanged, and explicit empty env unchanged", async () => {
  const received: unknown[] = [];
  const f = await fixture({
    compile: async () => {
      throw Error();
    },
    invoke: async ({ deployment: _d, principal: _p, input: _i, signal: _s, capabilityHandler: _cap, env }) => {
      received.push(env);
      return env?.STRIPE_KEY ?? null;
    },
  });
  try {
    assert.equal(
      await f.client.invoke(
        { deployment: {} as never, principal: principal, input: { field: "x", args: null }, env: { STRIPE_KEY: "sk_live_1" }, reuse: { kind: "one-shot" } },
      ),
      "sk_live_1",
    );
    assert.equal(
      await f.client.invoke({ deployment: {} as never, principal: principal, input: { field: "x", args: null }, env: {}, reuse: { kind: "one-shot" } }),
      null,
    );
    assert.deepEqual(received, [{ STRIPE_KEY: "sk_live_1" }, {}]);
  } finally {
    await f.close();
  }
});

test("the service refuses malformed env or backend-file scope before invoking the host", async () => {
  let calls = 0;
  const server = createServer(
    createExecutionService({
      secret,
      host: {
        compile: async () => {
          throw Error();
        },
        invoke: async () => {
          calls++;
          return null;
        },
      },
    }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as { port: number }).port;
    const invalid = [
      ...[undefined, null, "x", 1, [], { KEY: 1 }, { KEY: null }, { KEY: "" }, { "BAD NAME": "x" }].map(env => ({ env, reuse: { kind: "one-shot" } })),
      ...[null, "x", [], {}, { owner: "a" }, { owner: "", fileId: "f" },
        { owner: "a", fileId: 1 }, { owner: "a", fileId: "f", extra: "x" }]
        .map(scope => ({ env: {}, reuse: { kind: "file", scope } })),
      ...[undefined, null, {}, { kind: "unknown" }, { kind: "one-shot", scope: { owner: "a", fileId: "f" } }].map(reuse => ({ env: {}, reuse })),
    ];
    for (const metadata of invalid) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/execute`, {
        method: "POST",
        headers: { authorization: "Bearer " + secret, "content-type": "application/x-ndjson" },
        body: JSON.stringify({ kind: "invoke", deployment: {}, principal, input: { field: "x", args: null }, ...metadata }) + "\n",
      });
      const reply = JSON.parse((await response.text()).trim());
      assert.deepEqual(reply, { kind: "error", code: "backend_rejected" }, JSON.stringify(metadata));
    }
    assert.equal(calls, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("authenticated remote invocation carries trusted backend-file scope independently of arguments", async () => {
  const received: unknown[] = [];
  const f = await fixture({
    compile: async () => { throw Error(); },
    invoke: async ({ deployment: _d, principal: _p, input: _i, signal: _s, capabilityHandler: _cap, env: _env, reuse }) => { const scope = reuse.kind === "file" ? reuse.scope : undefined;  received.push(scope); return null; },
  });
  try {
    const scope = { owner: "owner-a", fileId: "backend-a" };
    await f.client.invoke({ deployment: {} as never, principal: principal, input: { field: "x", args: { scope: { owner: "forged", fileId: "forged" } } }, env: {}, reuse: { kind: "file", scope: scope } });
    await f.client.invoke({ deployment: {} as never, principal: principal, input: { field: "x", args: null }, env: {}, reuse: { kind: "one-shot" } });
    assert.deepEqual(received, [scope, undefined]);
  } finally { await f.close(); }
});

test("the server's configured backend host forwards the reuse decision through the capability authority", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { serviceConfig } = await import("../src/config.js");
  const received: unknown[] = [];
  const server = createServer(createExecutionService({
    secret,
    host: {
      compile: async () => { throw Error(); },
      invoke: async ({ reuse }) => { received.push(reuse); return null; },
    },
  }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "pagegi-resources-"));
  const resources = join(dir, "resources.json");
  writeFileSync(resources, JSON.stringify({ resources: {}, grants: [] }));
  const { backendHost } = serviceConfig({
    PAGEGI_BACKEND_EXECUTOR: "remote",
    PAGEGI_EXECUTION_ENDPOINT: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/execute`,
    PAGEGI_EXECUTION_SECRET: secret,
    PAGEGI_RESOURCE_CONFIG: resources,
  }) as { backendHost: BackendHost & { close(): Promise<void> } };
  try {
    const reuse = { kind: "file" as const, scope: { owner: "owner-a", fileId: "backend-a" } };
    for (const deployment of [{ version: "v1" }, { version: "v1", runtime: "pagegi/protocol@1/runtime" }])
      await backendHost.invoke({ deployment: deployment as never, principal, input: { field: "x", args: null }, env: {}, reuse });
    await backendHost.invoke({ deployment: { version: "v1" } as never, principal, input: { field: "x", args: null }, env: {}, reuse: { kind: "one-shot" } });
    assert.deepEqual(received, [reuse, reuse, { kind: "one-shot" }]);
  } finally {
    await backendHost.close();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed platform reuse decision rejects the remote invocation as a platform fault, never a caller quota", async () => {
  let calls = 0;
  const f = await fixture({
    compile: async () => { throw Error(); },
    invoke: async () => { calls++; return null; },
  });
  try {
    const reuses = [undefined, {}, { kind: "file" }, ...[{}, { owner: "a" }, { owner: "", fileId: "f" }, { owner: "a", fileId: "f", extra: "x" }]
      .map((scope) => ({ kind: "file", scope }))];
    for (const reuse of reuses) {
      let pending: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        pending = f.client.invoke({ deployment: {} as never, principal, input: { field: "x", args: null }, env: {}, reuse: reuse as never });
      });
      await assert.rejects(pending!, { code: "deployment_invalid" }, JSON.stringify(reuse));
    }
    let pending: Promise<unknown> | undefined;
    assert.doesNotThrow(() => {
      pending = f.client.invoke({ deployment: {} as never, principal, input: { field: "x", args: null }, env: { "bad name": "x" }, reuse: { kind: "one-shot" } });
    });
    // The same code the container host gives a malformed env, so the field reports it was never run.
    await assert.rejects(pending!, (error) => error instanceof BackendHostError && error.code === "input_quota");
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test("a capability the host gives up on settles at once and frees the service's slot", async () => {
  let clientAborted = 0;
  const f = await fixture(
    {
      compile: async () => {
        throw Error();
      },
      invoke: async ({ principal: p, capabilityHandler: cap }) => {
        // The host's own invoke deadline fires while the capability is outstanding.
        const deadline = AbortSignal.timeout(20);
        try {
          return await cap!(p, { kind: "invoke", resource: "db", operation: "read", input: null }, deadline);
        } catch (error) {
          throw error instanceof BackendHostError ? error : new BackendHostError("backend_rejected");
        }
      },
    },
    { maxConcurrent: 1, deadlineMs: 5000 },
  );
  const slow = (_p: unknown, _r: unknown, signal: AbortSignal) =>
    new Promise<never>((_resolve, reject) =>
      signal.addEventListener("abort", () => {
        clientAborted++;
        reject(Error("aborted"));
      }, { once: true }),
    );
  try {
    const started = Date.now();
    await assert.rejects(
      f.client.invoke({ deployment: {} as never, principal, input: { field: "x", args: null }, capabilityHandler: slow, env: {}, reuse: { kind: "one-shot" } }),
      { code: "cancelled" },
    );
    assert.ok(Date.now() - started < 2000, "settled by the host's deadline, not the service's");
    assert.equal(clientAborted, 1);
    assert.deepEqual(
      await f.client.invoke({ deployment: {} as never, principal, input: { field: "x", args: null }, capabilityHandler: async () => "ok", env: {}, reuse: { kind: "one-shot" } }),
      "ok",
    );
  } finally {
    await f.client.close();
    await f.close();
  }
});

test("trusted dataset_changed survives the remote execution capability roundtrip while raw codes are scrubbed", async () => {
  const { BackendDatasetChangedError } = await import(
    "../src/backend/contracts.ts"
  );
  const f = await fixture({
    async compile() {
      throw Error();
    },
    async invoke({ principal, capabilityHandler }) {
      return capabilityHandler!(principal, {
        kind: "dataset",
        operation: "read",
        input: {
          binding: "data",
          schema: "public",
          table: "rows",
          offset: 0,
          limit: 1,
        },
      },new AbortController().signal);
    },
  });
  try {
    for (const trusted of [true, false])
      await assert.rejects(
        f.client.invoke({
          deployment: {} as never,
          principal,
          input: { field: "read", args: null },
          env: {},
          reuse: { kind: "one-shot" },
          capabilityHandler: async () => {
            throw trusted
              ? new BackendDatasetChangedError()
              : Object.assign(Error("private detail"), {
                  code: "dataset_changed",
                });
          },
        }),
        { code: trusted ? "dataset_changed" : "backend_rejected" },
      );
  } finally {
    await f.client.close();
    await f.close();
  }
});

test("trusted dataset_mutation_rejected survives the remote execution capability roundtrip while raw codes are scrubbed", async () => {
  const { BackendDatasetMutationRejectedError } = await import(
    "../src/backend/contracts.ts"
  );
  const f = await fixture({
    async compile() {
      throw Error();
    },
    async invoke({ principal, capabilityHandler }) {
      return capabilityHandler!(
        principal,
        {
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
        new AbortController().signal,
      );
    },
  });
  try {
    for (const trusted of [true, false])
      await assert.rejects(
        f.client.invoke({
          deployment: {} as never,
          principal,
          input: { field: "read", args: null },
          env: {},
          reuse: { kind: "one-shot" },
          capabilityHandler: async () => {
            throw trusted
              ? new BackendDatasetMutationRejectedError()
              : Object.assign(Error("private detail"), {
                  code: "dataset_mutation_rejected",
                });
          },
        }),
        { code: trusted ? "dataset_mutation_rejected" : "backend_rejected" },
      );
  } finally {
    await f.client.close();
    await f.close();
  }
});
