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
