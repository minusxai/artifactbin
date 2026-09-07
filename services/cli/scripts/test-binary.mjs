import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const pty = require("node-pty");
const binary = resolve(
  `dist/afbin-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
);
let output = "",
  exitCode;
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  res.setHeader("Content-Type", "application/json");
  if (req.method === "GET") return res.end(JSON.stringify({ sessions: [] }));
  if (req.url === "/api/remote/sessions")
    return res.end(JSON.stringify({ id: "test", runnerKey: "key" }));
  output += body.output;
  exitCode = body.exitCode;
  res.end(
    JSON.stringify({
      controller: "local",
      inputs: body.ack
        ? []
        : [
            {
              id: 1,
              kind: "input",
              data: "binary-round-trip\r",
              source: "comment",
            },
          ],
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const child = pty.spawn(
  binary,
  [
    "remote",
    process.execPath,
    "-e",
    "process.stdin.once('data',d=>{process.stdout.write('got:'+d);process.exitCode=7;process.stdin.pause();})",
  ],
  {
    cwd: tmpdir(),
    cols: 80,
    rows: 24,
    env: {
      ...process.env,
      ARTIFACTBIN_URL: `http://127.0.0.1:${server.address().port}`,
      ARTIFACTBIN_TOKEN: "test",
    },
  },
);
let local = "";
child.onData((data) => (local += data));
const timeout = setTimeout(() => child.kill(), 15000);
try {
  const exit = await new Promise((r) => child.onExit(r));
  assert.equal(exit.exitCode, 7, local);
  assert.equal(exitCode, 7);
  assert.match(output, /got:binary-round-trip/);
  assert.match(local, /got:binary-round-trip/);
  console.log("Standalone binary PTY round trip passed outside the checkout.");
} finally {
  clearTimeout(timeout);
  server.close();
}
