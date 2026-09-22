import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
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
const home=await mkdtemp(join(tmpdir(),'afbin-binary-'));
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
    "--foreground",
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
      ARTIFACTBIN_HOME:home,ARTIFACTBIN_SKILLS:"off",CLI__AUTO_UPDATE:"off",
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
  output='';exitCode=undefined;
  const background=spawn(binary,['remote','--name','binary-test','--json',process.execPath,'-e',"setTimeout(()=>{console.log('detached-alive');process.exit(7)},500)"],{cwd:tmpdir(),env:{...process.env,ARTIFACTBIN_HOME:home,ARTIFACTBIN_SKILLS:'off',CLI__AUTO_UPDATE:'off',ARTIFACTBIN_URL:`http://127.0.0.1:${server.address().port}`,ARTIFACTBIN_TOKEN:'test'},stdio:['ignore','pipe','pipe']});
  let receipt='',errors='';background.stdout.on('data',v=>receipt+=v);background.stderr.on('data',v=>errors+=v);
  assert.equal(await new Promise(r=>background.on('exit',r)),0,errors);
  const started=JSON.parse(receipt);assert.equal(started.status,'starting');assert.equal(started.name,'binary-test');
  for(let i=0;i<100&&exitCode===undefined;i++)await delay(100);
  assert.equal(exitCode,7,'detached binary worker must report child exit');assert.match(output,/detached-alive/);
  console.log('Standalone binary detached worker passed outside the checkout.');

} finally {
  clearTimeout(timeout);
  server.close();
  await rm(home,{recursive:true,force:true});
}
