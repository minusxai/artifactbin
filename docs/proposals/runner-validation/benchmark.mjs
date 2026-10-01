import ivm from "isolated-vm";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { bundleProgram } from "./runner.mjs";
const bundle = await bundleProgram(
  fileURLToPath(new URL("./agent.ts", import.meta.url)),
);
const bare = [],
  agents = [],
  live = [];
const message = (count) => ({
  role: "assistant",
  api: "openai-completions",
  provider: "openai",
  model: "fixture",
  content:
    count === 1
      ? [{ type: "toolCall", id: "read", name: "read_artifact", arguments: {} }]
      : count === 2
        ? [
            {
              type: "toolCall",
              id: "reply",
              name: "reply_comment",
              arguments: { body: "ok" },
            },
          ]
        : [{ type: "text", text: "done" }],
  stopReason: count < 3 ? "toolUse" : "stop",
  timestamp: Date.now(),
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
for (let n = 0; n < 100; n++) {
  const start = performance.now(),
    iso = new ivm.Isolate({ memoryLimit: 32 });
  iso.createContextSync().evalSync("1+1");
  bare.push({
    ms: performance.now() - start,
    heap: iso.getHeapStatisticsSync().used_heap_size,
  });
  iso.dispose();
}
for (let n = 0; n < 20; n++) {
  const start = performance.now(),
    iso = new ivm.Isolate({ memoryLimit: 64 }),
    ctx = iso.createContextSync();
  let count = 0,
    next;
  const ref = new ivm.Reference(async (op) => {
    if (op === "open") {
      next = {
        type: "done",
        reason: count < 2 ? "toolUse" : "stop",
        message: message(++count),
      };
      return { streamId: "fixture" };
    }
    if (op === "next") {
      const event = next;
      next = null;
      return event;
    }
    return {};
  });
  ctx.evalSync("globalThis.window=globalThis;globalThis.self=globalThis;");
  ctx.evalClosureSync(
    `globalThis.cap=(()=>{const call=op=>$0.apply(undefined,[op],{arguments:{copy:true},result:{promise:true,copy:true}});return {artifactbin:{read:()=>call('read'),reply:()=>call('reply')},ai:{open:()=>call('open'),next:()=>call('next')},emit:()=>call('emit')}})()`,
    [ref],
  );
  ctx.evalSync(bundle, { timeout: 2000 });
  const loaded = performance.now();
  const result = await ctx.eval(
    'Program.default({artifactId:"fixture",message:"hello",history:[]},cap)',
    { promise: true, copy: true, timeout: 2000 },
  );
  if (result.outcome !== "completed" || count !== 3)
    throw Error("agent failed");
  agents.push({
    load: loaded - start,
    total: performance.now() - start,
    heap: iso.getHeapStatisticsSync().used_heap_size,
  });
  iso.dispose();
}
global.gc?.();
const baseline = process.memoryUsage().rss;
for (let n = 0; n < 100; n++) {
  const iso = new ivm.Isolate({ memoryLimit: 16 });
  iso.createContextSync();
  live.push(iso);
}
const additional = process.memoryUsage().rss - baseline;
for (const iso of live) iso.dispose();
const median = (a) => a.toSorted((a, b) => a - b)[Math.floor(a.length / 2)];
const report = {
  runtime: process.version,
  platform: process.platform,
  arch: process.arch,
  scope:
    "warm host; in-memory model fixture; excludes IPC, queue, network, real inference",
  bundleBytes: Buffer.byteLength(bundle),
  bare: {
    samples: 100,
    createAndArithmeticMedianMs: median(bare.map((s) => s.ms)),
    heapKiB: median(bare.map((s) => s.heap)) / 1024,
  },
  pi: {
    samples: 20,
    loadMedianMs: median(agents.map((s) => s.load)),
    throughToolLoopMedianMs: median(agents.map((s) => s.total)),
    heapMiB: median(agents.map((s) => s.heap)) / 1024 / 1024,
  },
  additional100ContextsRssMiB: additional / 1024 / 1024,
};
writeFileSync(
  new URL("./benchmark-results.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
