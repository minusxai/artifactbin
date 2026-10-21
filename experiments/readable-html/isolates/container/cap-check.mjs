import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import assert from "node:assert/strict";
import { createConnectorHost } from "../../connectors/host.mjs";
const caller = Object.freeze({
  tenantId: "tenant-a",
  userId: "alice",
  grants: ["data"],
});
let upstreamCalls = 0;
const upstream = http.createServer(async (req, res) => {
  upstreamCalls++;
  assert.equal(req.headers.authorization, "Bearer fixture-secret-only-on-host");
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  assert.equal(body.caller.tenantId, caller.tenantId);
  assert.equal(body.caller.userId, caller.userId);
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      tenant: body.caller.tenantId,
      user: body.caller.userId,
      value: 7,
    }),
  );
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const connector = createConnectorHost({
  data: {
    kind: "http",
    origin: `http://127.0.0.1:${upstream.address().port}`,
    token: "fixture-secret-only-on-host",
    operations: { echo: { path: "/echo", method: "POST" } },
  },
});
const name = `pg-isolate-proof-capability-${process.pid}`;
const abort = new AbortController();
let child;
try {
  child = spawn(
    "docker",
    [
      "run",
      "-i",
      "--pull=never",
      "--name",
      name,
      "--memory=256m",
      "--memory-swap=256m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--network=none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,nodev,size=16m",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user=10001:10001",
      "pagegi-isolate-proof:local",
      "capability",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let buffer = "",
    errors = "",
    result,
    requests = 0;
  const pending = [];
  child.stderr.on("data", (c) => (errors = (errors + c).slice(-2000)));
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("capability deadline")), 10000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error(`container ${code}: ${errors}`));
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 65536)
        return reject(Error("frame quota"));
      let pos;
      while ((pos = buffer.indexOf("\n")) >= 0) {
        let message;
        try {
          message = JSON.parse(buffer.slice(0, pos));
        } catch (e) {
          reject(e);
          return;
        }
        buffer = buffer.slice(pos + 1);
        if (message.type === "result") {
          result = message;
          continue;
        }
        if (message.type !== "capability" || ++requests > 8) {
          reject(Error("capability quota"));
          return;
        }
        pending.push(
          (async () => {
            let reply;
            try {
              const value = await connector.invoke(
                caller,
                message.request,
                abort.signal,
              );
              reply = { id: message.id, ok: true, value };
            } catch {
              reply = { id: message.id, ok: false };
            }
            const line = JSON.stringify(reply) + "\n";
            assert.ok(Buffer.byteLength(line) <= 65536);
            child.stdin.write(line);
          })().catch(reject),
        );
      }
    });
  });
  child.stdin.write(
    JSON.stringify({
      type: "init",
      principal: { tenant: caller.tenantId, subject: caller.userId },
    }) + "\n",
  );
  await done;
  await Promise.all(pending);
  assert.deepEqual(result.allowed.value, {
    tenant: "tenant-a",
    user: "alice",
    value: 7,
  });
  assert.equal(result.denied.status, 400);
  assert.equal(result.pending, 0);
  assert.equal(result.secret, null);
  assert.equal(requests, 2);
  assert.equal(upstreamCalls, 1);
  const info = JSON.parse(
    spawnSync("docker", ["inspect", name], { encoding: "utf8" }).stdout,
  )[0];
  assert.equal(info.HostConfig.NetworkMode, "none");
  assert.equal(info.HostConfig.Binds, null);
  assert.equal(info.State.Running, false);
  console.log(
    JSON.stringify({
      mode: "capability",
      transport: "bounded stdio",
      actualConnector: "HTTP",
      requests,
      upstreamCalls,
      spoofedIdentityIgnored: true,
      unauthorizedResourceDenied: true,
      noHostMounts: true,
      network: "none",
      pending: 0,
    }),
  );
} finally {
  abort.abort();
  child?.stdin.destroy();
  const removed = spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
  const absent = spawnSync("docker", ["inspect", name], { encoding: "utf8" });
  await connector.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /No such (object|container)/i);
}
