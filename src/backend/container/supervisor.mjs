import { checkedBackendEnv } from "./env-policy.mjs";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import assert from "node:assert/strict";
// Refuse execution if the launcher omitted any required OS boundary.
assert.equal(
  (await readFile("/sys/fs/cgroup/memory.max", "utf8")).trim(),
  "268435456",
);
assert.equal(
  (await readFile("/sys/fs/cgroup/memory.swap.max", "utf8")).trim(),
  "0",
);
assert.equal(
  (await readFile("/sys/fs/cgroup/cpu.max", "utf8")).trim(),
  "50000 100000",
);
assert.equal((await readFile("/sys/fs/cgroup/pids.max", "utf8")).trim(), "64");
assert.equal(process.getuid(), 10001);
const status = await readFile("/proc/self/status", "utf8");
assert.match(status, /CapEff:\s+0000000000000000/);
assert.match(status, /NoNewPrivs:\s+1/);
assert.match(status, /Seccomp:\s+2/);
const interfaces = (await readFile("/proc/net/dev", "utf8"))
  .split("\n")
  .filter((x) => x.includes(":"))
  .map((x) => x.split(":")[0].trim())
  .sort();
// Compilation never has a network; a lambda has at most the sandbox bridge (checked per request below).
assert.ok(
  interfaces.join() === "lo" || interfaces.join() === "eth0,lo",
  "network",
);
await assert.rejects(writeFile("/app/forbidden", "x"), /EROFS|EACCES/);
// Incremental fatal UTF-8 decoding: a replacement character must never change a frame.
// The first frame is the request: `compile` or `invoke` serve one call and exit;
// `serve` keeps the bundle's worker running and serves one `invoke` frame at a
// time, answering each with a `result` frame, until the host closes stdin.
let input = Buffer.alloc(0),
  totalInput = 0,
  request;
const pending = new Map();
let bridgeId = 0,
  bridgeCount = 0,
  bridgeBytes = 0;
let child, dir, bridge;
let calling = false,
  queued = null,
  awaitingInvoke = null;
let acceptRequest;
const firstRequest = new Promise((resolve) => {
  acceptRequest = resolve;
});
process.stdin.on("data", (chunk) => {
  try {
    totalInput += chunk.length;
    if (totalInput > 4500000) throw Error();
    input = Buffer.concat([input, chunk]);
    let newline;
    while ((newline = input.indexOf(10)) >= 0) {
      if (newline > 1500000) throw Error();
      const frame = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          input.subarray(0, newline),
        ),
      );
      input = input.subarray(newline + 1);
      if (!request) {
        request = frame;
        acceptRequest(frame);
      } else if (frame.kind === "capability-result") {
        if (!pending.has(frame.id) || typeof frame.ok !== "boolean")
          throw Error();
        const resolve = pending.get(frame.id);
        pending.delete(frame.id);
        resolve(frame);
      } else if (
        request.kind === "serve" &&
        frame.kind === "invoke" &&
        !calling &&
        !queued
      ) {
        // One call at a time: the next invoke arrives only after the result frame.
        if (awaitingInvoke) {
          const resume = awaitingInvoke;
          awaitingInvoke = null;
          resume(frame);
        } else queued = frame;
      } else throw Error();
    }
    if (input.length > 1500000) throw Error();
  } catch {
    process.exit(1);
  }
});
process.stdin.on("end", () => {
  if (input.length || pending.size || !request) process.exit(1);
  if (request.kind === "serve") {
    // The host retires a served sandbox by closing its input; mid-call is a fault.
    child?.kill("SIGKILL");
    process.exit(calling || queued ? 1 : 0);
  }
});
await firstRequest;
if (request.kind === "compile") assert.equal(interfaces.join(), "lo");
let bundle = request.bundle;
/** The backend owner's secrets, checked again here: names go into the workerd config. */
let env;
try {
  env = checkedBackendEnv(request.kind === "compile" ? {} : (request.env ?? {}));
} catch {
  process.exit(1);
}
/** One request to the worker, settled with its parsed JSON answer. */
const call = (body) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { socketPath: dir + "/s", path: "/", method: "POST" },
      (res) => {
        let total = 0,
          text = [];
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > 70000) {
            req.destroy();
            reject(Error());
          } else text.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(text).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      },
    );
    const exited = () => req.destroy(Error("worker exited"));
    req.on("error", reject);
    req.on("close", () => child.off("exit", exited));
    child.once("exit", exited);
    req.end(JSON.stringify(body));
  });
/** The code for a worker failure: the kernel's OOM kill, else the worker's own fault. */
const failureCode = async () => {
  const events = await readFile("/sys/fs/cgroup/memory.events", "utf8");
  const oom = Number(events.match(/^oom_kill (\d+)$/m)?.[1] ?? 0);
  return oom > 0 ? "memory_limit" : "backend_rejected";
};
try {
  if (request.kind === "compile") {
    if (
      typeof request.source !== "string" ||
      Buffer.byteLength(request.source) > 262144
    )
      throw Error();
    try {
      const { bundleBackend } = await import("./bundle.mjs");
      bundle = await bundleBackend(request);
    } catch {
      process.stdout.write(
        JSON.stringify({ ok: false, code: "build_rejected" }),
      );
      process.exit(0);
    }
  }
  if (typeof bundle !== "string" || Buffer.byteLength(bundle) > 1048576)
    throw Error();
  dir = await mkdtemp("/tmp/backend-");
  await writeFile(dir + "/backend.js", bundle);
  await writeFile(dir + "/entry.js", await readFile("/app/entry.mjs"));
  bridge = http.createServer(async (req, res) => {
    try {
      if (
        (request.kind !== "invoke" && request.kind !== "serve") ||
        !request.duplex ||
        req.method !== "POST" ||
        req.url !== "/" ||
        ++bridgeCount > 100 ||
        pending.size >= 8
      )
        throw Error();
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        bridgeBytes += chunk.length;
        if (bytes > 65536 || bridgeBytes > 1048576) throw Error();
        chunks.push(chunk);
      }
      const capability = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      const id = ++bridgeId;
      const reply = new Promise((resolve) => pending.set(id, resolve));
      process.stdout.write(
        JSON.stringify({ kind: "capability", id, request: capability }) + "\n",
      );
      const value = await reply;
      res.end(JSON.stringify(value));
    } catch {
      res.statusCode = 400;
      res.end('{"ok":false}');
    }
  });
  await new Promise((resolve, reject) => {
    bridge.once("error", reject);
    bridge.listen(dir + "/bridge", resolve);
  });
  // Secrets become text bindings, read from files so no value is ever quoted into the config.
  await mkdir(dir + "/env", { mode: 0o700 });
  const bindings = ['(name="pagegi_capability",service="capability")'];
  for (const [name, value] of Object.entries(env)) {
    await writeFile(dir + "/env/" + name, value, { mode: 0o600 });
    bindings.push(`(name="${name}",text=embed "env/${name}")`);
  }
  // Lambdas reach public addresses only; https trusts Node's root CAs (the image has no CA store).
  let network = "allow=[]";
  if (request.kind !== "compile") {
    await symlink("/app/ca.pem", dir + "/ca.pem");
    network =
      'allow=["public"],deny=["private","local"],tlsOptions=(trustedCertificates=[embed "ca.pem"])';
  }
  await writeFile(
    dir + "/config.capnp",
    `using W=import "/workerd/workerd.capnp";const config:W.Config=(services=[(name="app",worker=(compatibilityDate="2026-10-01",compatibilityFlags=["nodejs_compat","nodejs_compat_do_not_populate_process_env"],modules=[(name="entry.js",esModule=embed "entry.js"),(name="backend.js",esModule=embed "backend.js")],bindings=[${bindings.join(",")}],globalOutbound="internet")),(name="internet",network=(${network})),(name="capability",external=(address="unix:${dir}/bridge",http=()))],sockets=[(name="s",address="unix:${dir}/s",http=(),service="app")]);`,
  );
  child = spawn(
    "/app/node_modules/.bin/workerd",
    ["serve", dir + "/config.capnp"],
    { env: {}, stdio: ["ignore", "ignore", "ignore"] },
  );
  const ended = new Promise((resolve) => child.once("exit", resolve));
  child.on("error", () => {});
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode) throw Error();
    try {
      await stat(dir + "/s");
      ready = true;
      break;
    } catch {}
    await new Promise((r) => setTimeout(r, 10));
  }
  if (!ready) throw Error();
  if (request.kind === "serve") {
    for (;;) {
      let next = queued;
      queued = null;
      if (!next)
        next = await new Promise((resolve) => {
          awaitingInvoke = resolve;
        });
      calling = true;
      // Quotas are per call: the worker's own counters start over with each request too.
      bridgeCount = 0;
      bridgeBytes = 0;
      totalInput = 0;
      let result;
      try {
        result = await call({
          kind: "invoke",
          principal: next.principal,
          input: next.input,
        });
      } catch {
        result = { ok: false, code: await failureCode() };
      }
      calling = false;
      process.stdout.write(JSON.stringify({ kind: "result", ...result }) + "\n");
      if (child.exitCode !== null || child.signalCode) process.exit(1);
    }
  }
  const result = await call(
    request.kind === "compile"
      ? { kind: "compile" }
      : { kind: "invoke", principal: request.principal, input: request.input },
  );
  child.kill("SIGKILL");
  await ended;
  if (result.ok && request.kind === "compile")
    result.value = { bundle, metadata: result.value };
  process.stdout.write(JSON.stringify(result) + "\n");
} catch {
  process.stdout.write(
    JSON.stringify({ ok: false, code: await failureCode() }),
  );
} finally {
  child?.kill("SIGKILL");
  bridge?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
}
