import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runRemote } from "../src/runner";
test("real PTY delivers a remote line and relays output and exit, acknowledging each input once", async () => {
  let output = "",
    ack = 0;
  let exit: number | undefined;
  let exchanges = 0;
  let local = "";
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/remote/sessions") {
      res.end(JSON.stringify({ id: "test", runnerKey: "runner" }));
      return;
    }
    exchanges++;
    output += body.output;
    ack = body.ack;
    exit = body.exitCode;
    res.end(
      JSON.stringify({
        controller: "local",
        inputs: ack
          ? []
          : [
              {
                id: 1,
                kind: "input",
                source: "comment",
                data: "from-comment\r",
              },
            ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  try {
    const code = await runRemote({
      connection: { server: `http://127.0.0.1:${address.port}`, token: "test" },
      command: "/bin/sh",
      args: ["-c", 'read line; printf "received:%s\\n" "$line"; exit 7'],
      interactive: false,
      onOutput: (data) => (local += data),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(code, 7);
    assert.match(output, /received:from-comment/);
    assert.match(local, /received:from-comment/);
    assert.equal(ack, 1);
    assert.equal(exit, 7);
    assert.ok(exchanges >= 2);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("exits promptly when the relay hangs after the child exits", async () => {
  let exchanges = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain request */ }
    if (req.url === "/api/remote/sessions") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "shutdown", runnerKey: "runner" }));
    } else {
      exchanges++;
      // Deliberately never respond: shutdown must cancel the pending exchange.
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const start = Date.now();
  try {
    const code = await runRemote({
      connection: { server: `http://127.0.0.1:${address.port}`, token: "test" },
      command: "/bin/sh",
      args: ["-c", "sleep 0.1; exit 0"],
      interactive: false,
      onOutput: () => {},
    });
    assert.equal(code, 0);
    assert.ok(exchanges > 0);
    assert.ok(Date.now() - start < 3000, "must not wait for the 10 second request timeout");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("interactive exit detaches late input and resize while flushing the final exchange", async (t) => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const raw = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "setRawMode", { value: () => process.stdin, configurable: true });
  t.after(() => {
    if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (raw) Object.defineProperty(process.stdin, "setRawMode", raw);
    else delete (process.stdin as { setRawMode?: unknown }).setRawMode;
  });
  t.mock.method(process.stdin, "resume", () => process.stdin);
  t.mock.method(process.stdin, "pause", () => process.stdin);
  let messages = "";
  t.mock.method(process.stderr, "write", (data: string) => { messages += data; return true; });
  const inputListeners = process.stdin.listenerCount("data");
  const resizeListeners = process.stdout.listenerCount("resize");
  let sawExit = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "exit", runnerKey: "runner" });
    if (body.exitCode !== undefined) {
      sawExit = true;
      assert.equal(process.stdin.listenerCount("data"), inputListeners);
      assert.equal(process.stdout.listenerCount("resize"), resizeListeners);
      process.stdin.emit("data", Buffer.from("\x03"));
      process.stdout.emit("resize");
    }
    return Response.json({ controller: "local", inputs: [] });
  });
  const code = await runRemote({
    connection: { server: "https://example.com", token: "test" },
    command: "/bin/sh", args: ["-c", "exit 0"], interactive: true,
    onOutput: () => {},
  });
  assert.equal(code, 0);
  assert.ok(sawExit);
  assert.match(messages, /Closing session/);
  assert.match(messages, /Session closed/);
  assert.doesNotMatch(messages, /remote access interrupted/);
});

test("mobile dimensions survive local terminal replies and typing", async (t) => {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const raw = Object.getOwnPropertyDescriptor(process.stdin, "setRawMode");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "setRawMode", { value: () => process.stdin, configurable: true });
  t.after(() => {
    if (tty) Object.defineProperty(process.stdin, "isTTY", tty);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (raw) Object.defineProperty(process.stdin, "setRawMode", raw);
    else delete (process.stdin as { setRawMode?: unknown }).setRawMode;
  });
  t.mock.method(process.stdin, "resume", () => process.stdin);
  t.mock.method(process.stdin, "pause", () => process.stdin);
  t.mock.method(process.stderr, "write", () => true);
  const exchanges: Array<{ cols: number; rows: number; localControl?: boolean }> = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "mobile", runnerKey: "runner" });
    exchanges.push(body);
    if (exchanges.length === 2) {
      // A terminal replies to the harness's cursor-position query after its redraw.
      process.stdin.emit("data", Buffer.from("\x1b[12;5R"));
      process.stdin.emit("data", Buffer.from("hello"));
    }
    return Response.json({ controller: "web", inputs: exchanges.length === 1
      ? [{ id: 1, kind: "resize", source: "keyboard", cols: 41, rows: 32 }]
      : [] });
  });
  const code = await runRemote({
    connection: { server: "https://example.com", token: "test" },
    command: "/bin/sh", args: ["-c", "sleep 1; exit 0"], interactive: true,
    onOutput: () => {},
  });
  assert.equal(code, 0);
  assert.ok(exchanges.length >= 3);
  for (const frame of exchanges.slice(1)) {
    assert.equal(frame.cols, 41);
    assert.equal(frame.rows, 32);
    assert.ok(!frame.localControl, "terminal replies must not reclaim dimensions");
  }
});

test("retries the same batch after a lost response and recreates a missing session without restarting the PTY", async (t) => {
  let registrations = 0;
  let calls = 0;
  const urls: string[] = [];
  let failedBatch: unknown;
  let local = "";
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: `session-${++registrations}`, runnerKey: `key-${registrations}` });
    calls++;
    if (calls === 1) {
      failedBatch = body;
      throw new TypeError("fetch failed");
    }
    if (calls === 2) {
      assert.deepEqual(body, failedBatch, "retry preserves output sequence and input acknowledgement");
      return Response.json({ controller: "local", inputs: [{ id: 1, kind: "input", data: "first\r" }] });
    }
    if (calls === 3) return Response.json({ error: "Session not found" }, { status: 404 });
    assert.match(String(url), /session-2\/exchange$/);
    assert.equal(body.runnerKey, "key-2");
    if (calls === 4) {
      assert.equal(body.ack, 0);
      assert.equal(body.outputSeq, 1);
    }
    return Response.json({ controller: "local", inputs: body.ack ? [] : [{ id: 1, kind: "input", data: "second\r" }] });
  });
  const code = await runRemote({
    connection: { server: "https://example.com", token: "test" },
    command: "/bin/sh", args: ["-c", 'read a; read b; printf "result:%s:%s\\n" "$a" "$b"'],
    interactive: false, onOutput: data => { local += data; }, onSession: url => urls.push(url),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(code, 0);
  assert.equal(registrations, 2);
  assert.equal(urls.length, 2);
  assert.match(local, /result:first:second/);
});

test("output overflow keeps the local PTY running and the relay reconnecting", async (t) => {
  let calls = 0;
  let bytes = 0;
  let recovered = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "overflow", runnerKey: "runner" });
    calls++;
    if (calls < 3) return Response.json({ error: "Unavailable" }, { status: 503 });
    recovered = true;
    assert.ok(body.output.length <= 60000);
    return Response.json({ controller: "local", inputs: body.ack ? [] : [{ id: 1, kind: "input", data: "done\r" }] });
  });
  const code = await runRemote({
    connection: { server: "https://example.com", token: "test" },
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.stdin.once('data', () => process.exit(0));"],
    interactive: false, onOutput: data => { bytes += data.length; },
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(code, 0);
  assert.ok(bytes >= 2 * 1024 * 1024);
  assert.ok(recovered);
});

for (const status of [401, 403]) test(`HTTP ${status} stops retries but lets the local child finish`, async (t) => {
  let calls = 0;
  let local = "";
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "auth", runnerKey: "runner" });
    calls++;
    return Response.json({ error: "Unauthorized" }, { status });
  });
  const code = await runRemote({
    connection: { server: "https://example.com", token: "test" },
    command: "/bin/sh", args: ["-c", "sleep 0.3; echo still-local"],
    interactive: false, onOutput: data => { local += data; },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.match(local, /still-local/);
});

test("child exit interrupts reconnect backoff promptly", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!body.runnerKey) return Response.json({ id: "backoff", runnerKey: "runner" });
    calls++;
    return Response.json({ error: "Unavailable" }, { status: 503 });
  });
  const start = Date.now();
  const code = await runRemote({
    connection: { server: "https://example.com", token: "test" },
    command: "/bin/sh", args: ["-c", "sleep 1.7; exit 0"],
    interactive: false, onOutput: () => {},
    signal: AbortSignal.timeout(6000),
  });
  assert.equal(code, 0);
  assert.equal(calls, 3);
  assert.ok(Date.now() - start < 3300, "shutdown must interrupt the two-second reconnect wait");
});
