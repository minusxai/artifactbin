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
