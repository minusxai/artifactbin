import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
const mode = process.argv[2];
const read = (path) => readFile(path, "utf8");
const stat = async (name) =>
  Object.fromEntries(
    (await read("/sys/fs/cgroup/" + name))
      .trim()
      .split("\n")
      .map((l) => l.split(" "))
      .map(([k, v]) => [k, Number(v)]),
  );
assert.equal((await read("/sys/fs/cgroup/memory.max")).trim(), "268435456");
assert.equal((await read("/sys/fs/cgroup/memory.swap.max")).trim(), "0");
assert.equal((await read("/sys/fs/cgroup/cpu.max")).trim(), "50000 100000");
assert.equal((await read("/sys/fs/cgroup/pids.max")).trim(), "64");
assert.equal(process.getuid(), 10001);
const status = await read("/proc/self/status");
assert.match(status, /CapEff:\s+0000000000000000/);
assert.match(status, /NoNewPrivs:\s+1/);
assert.match(status, /Seccomp:\s+2/);
assert.deepEqual(
  (await read("/proc/net/dev"))
    .split("\n")
    .filter((l) => l.includes(":"))
    .map((l) => l.split(":")[0].trim()),
  ["lo"],
);
await assert.rejects(writeFile("/app/forbidden", "no"), /EROFS|EACCES/);
if (mode === "capability") {
  await import("./cap-probe.mjs");
  process.exit(0);
}
if (mode === "compile") {
  const { build } = await import("esbuild");
  const options = {
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    logLevel: "silent",
    plugins: [
      {
        name: "deny-imports",
        setup(b) {
          b.onResolve({ filter: /.*/ }, () => ({
            errors: [{ text: "Import denied" }],
          }));
        },
      },
    ],
  };
  const source = "export const n:number=42;";
  const result = await build({
    ...options,
    stdin: { contents: source, loader: "ts" },
  });
  assert.match(result.outputFiles[0].text, /42/);
  await assert.rejects(
    build({
      ...options,
      stdin: {
        contents: "import x from '/etc/passwd';console.log(x)",
        loader: "ts",
      },
    }),
    /Import denied/,
  );
  const bounded = " ".repeat(262000) + source;
  assert.ok(Buffer.byteLength(bounded) <= 262144);
  await build({ ...options, stdin: { contents: bounded, loader: "ts" } });
  console.log(
    JSON.stringify({
      mode,
      compiled: true,
      importsDenied: true,
      sourceBytes: Buffer.byteLength(bounded),
      memoryMax: 268435456,
      cpuQuota: "50000 100000",
      uid: process.getuid(),
      network: "none",
      root: "read-only",
    }),
  );
  process.exit(0);
}
const dir = await mkdtemp("/tmp/probe-");
await writeFile(
  dir + "/main.js",
  `export default {async fetch(){${mode === "memory" ? "const a=[];while(true){const b=new Uint8Array(8*1024*1024);b.fill(3);a.push(b)}" : mode === "cpu" ? "while(true){}" : "return Response.json({ok:true,secret:typeof process==='undefined'?null:process.env.HOST_SECRET??null})"}}}`,
);
await writeFile(
  dir + "/config.capnp",
  `using W=import "/workerd/workerd.capnp";const config:W.Config=(services=[(name="app",worker=(compatibilityDate="2026-10-01",modules=[(name="main.js",esModule=embed "main.js")],globalOutbound="internet")),(name="internet",network=(allow=[]))],sockets=[(name="s",address="unix:${dir}/s",http=(),service="app")]);`,
);
const beforeMemory = await stat("memory.events"),
  beforeCpu = await stat("cpu.stat");
const child = spawn(
  "/app/node_modules/.bin/workerd",
  ["serve", dir + "/config.capnp"],
  { env: {}, stdio: ["ignore", "ignore", "pipe"] },
);
let errors = "";
child.stderr.on("data", (x) => (errors = (errors + x).slice(-1000)));
const exit = new Promise((resolve) =>
  child.on("exit", (code, signal) => resolve({ code, signal })),
);
let ready = false;
for (let i = 0; i < 100; i++) {
  try {
    await readFile(dir + "/s");
  } catch (e) {
    if (e.code !== "ENOENT") {
      ready = true;
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 20));
}
assert.ok(ready, "worker socket did not start: " + errors);
const request = new Promise((resolve) => {
  const req = http.get({ socketPath: dir + "/s", path: "/" }, (res) => {
    let text = "";
    res.on("data", (x) => (text += x));
    res.on("end", () => resolve({ text }));
  });
  req.on("error", (e) => resolve({ error: e.code }));
});
let result;
if (mode === "normal") {
  const response = await request;
  assert.ok(
    response.text,
    JSON.stringify({
      response,
      errors,
      exitCode: child.exitCode,
      signal: child.signalCode,
    }),
  );
  assert.deepEqual(JSON.parse(response.text), { ok: true, secret: null });
  child.kill("SIGKILL");
  await exit;
  result = { mode, normal: true };
} else if (mode === "memory") {
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 8000);
  const ended = await exit;
  clearTimeout(watchdog);
  await request;
  const after = await stat("memory.events");
  assert.ok(
    after.oom_kill > beforeMemory.oom_kill,
    "real cgroup OOM kill required, not watchdog",
  );
  assert.equal(ended.signal, "SIGKILL");
  result = {
    mode,
    oomKills: after.oom_kill - beforeMemory.oom_kill,
    peakBytes: Number((await read("/sys/fs/cgroup/memory.peak")).trim()),
    limitBytes: 268435456,
  };
} else {
  await new Promise((r) => setTimeout(r, 1500));
  const after = await stat("cpu.stat");
  child.kill("SIGKILL");
  await exit;
  await request;
  assert.ok(after.nr_throttled > beforeCpu.nr_throttled);
  assert.ok(after.throttled_usec > beforeCpu.throttled_usec);
  result = {
    mode,
    throttledPeriods: after.nr_throttled - beforeCpu.nr_throttled,
    throttledMicros: after.throttled_usec - beforeCpu.throttled_usec,
    cpuMicros: after.usage_usec - beforeCpu.usage_usec,
  };
}
await rm(dir, { recursive: true, force: true });
console.log(
  JSON.stringify({
    ...result,
    uid: process.getuid(),
    network: "none",
    root: "read-only",
    capabilities: "none",
    seccomp: true,
    remainingChild: false,
  }),
);
