import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import http from "node:http";
let buffer = "",
  initResolve;
const initialized = new Promise((r) => (initResolve = r));
const pending = new Map();
let sequence = 0,
  calls = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  if (Buffer.byteLength(buffer) > 65536) process.exit(3);
  let pos;
  while ((pos = buffer.indexOf("\n")) >= 0) {
    const message = JSON.parse(buffer.slice(0, pos));
    buffer = buffer.slice(pos + 1);
    if (message.type === "init") initResolve(message.principal);
    else {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message);
    }
  }
});
const principal = await initialized;
const bridge = http.createServer(async (req, res) => {
  try {
    if (++calls > 8) throw Error("quota");
    const chunks = [];
    let bytes = 0;
    for await (const c of req) {
      bytes += c.length;
      if (bytes > 65536) throw Error("quota");
      chunks.push(c);
    }
    const request = JSON.parse(Buffer.concat(chunks).toString());
    const id = ++sequence;
    const reply = new Promise((resolve) => pending.set(id, resolve));
    console.log(JSON.stringify({ type: "capability", id, request }));
    const message = await reply;
    if (!message.ok) throw Error("denied");
    res.end(JSON.stringify(message.value));
  } catch {
    res.writeHead(400);
    res.end("denied");
  }
});
await new Promise((r) => bridge.listen(0, "127.0.0.1", r));
const port = bridge.address().port;
const dir = await mkdtemp("/tmp/cap-");
const source = `export default {async fetch(req,env){const invoke=async request=>{const r=await env.CAP.fetch('http://cap/',{method:'POST',body:JSON.stringify(request)});return {status:r.status,value:r.ok?await r.json():null}};const allowed=await invoke({resource:'data',operation:'echo',input:{tenantId:'evil',userId:'evil'}});const denied=await invoke({resource:'admin',operation:'echo',input:null});let rawBlocked=false;try{await fetch('http://host.docker.internal:1')}catch{rawBlocked=true}return Response.json({allowed,denied,rawBlocked,context:JSON.parse(env.PRINCIPAL),secret:typeof process==='undefined'?null:process.env.CONNECTOR_SECRET??null})}}`;
await writeFile(dir + "/main.js", source);
await writeFile(
  dir + "/config.capnp",
  `using W=import "/workerd/workerd.capnp";const config:W.Config=(services=[(name="app",worker=(compatibilityDate="2026-10-01",modules=[(name="main.js",esModule=embed "main.js")],bindings=[(name="PRINCIPAL",text=${JSON.stringify(JSON.stringify(principal))}),(name="CAP",service="cap")],globalOutbound="internet")),(name="internet",network=(allow=[])),(name="cap",external=(address="127.0.0.1:${port}",http=()))],sockets=[(name="s",address="unix:${dir}/s",http=(),service="app")]);`,
);
const child = spawn(
  "/app/node_modules/.bin/workerd",
  ["serve", dir + "/config.capnp"],
  { env: {}, stdio: ["ignore", "ignore", "pipe"] },
);
let errors = "";
child.stderr.on("data", (x) => (errors = (errors + x).slice(-1000)));
const exited = new Promise((r) => child.once("exit", r));
const response = await new Promise((resolve, reject) => {
  const attempt = () => {
    const req = http.get({ socketPath: dir + "/s", path: "/" }, (res) => {
      let text = "";
      res.on("data", (x) => {
        text += x;
        if (Buffer.byteLength(text) > 65536) req.destroy();
      });
      res.on("end", () => resolve(text));
    });
    req.on("error", (e) => {
      if (e.code === "ENOENT" || e.code === "ECONNREFUSED")
        setTimeout(attempt, 20);
      else reject(e);
    });
  };
  attempt();
});
const result = JSON.parse(response);
assert.equal(result.allowed.status, 200);
assert.equal(result.denied.status, 400);
assert.deepEqual(result.context, principal);
assert.equal(result.rawBlocked, true);
assert.equal(result.secret, null);
child.kill("SIGKILL");
await exited;
bridge.closeAllConnections();
await new Promise((r) => bridge.close(r));
await rm(dir, { recursive: true, force: true });
console.log(
  JSON.stringify({
    type: "result",
    mode: "capability",
    ...result,
    pending: pending.size,
  }),
);
process.stdin.pause();
