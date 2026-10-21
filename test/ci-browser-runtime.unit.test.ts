import assert from "node:assert/strict";
import { test } from "node:test";
import { browserRuntimePlan, provisionBrowserRuntime } from "../scripts/ci/browser-runtime.ts";
import type { BrowserEngine, CIBrowserRuntimeOperations } from "../scripts/ci/contracts.ts";
function operations(fail?: (engine: BrowserEngine, calls: string[]) => void) {
  const calls: string[] = [];
  const ops: CIBrowserRuntimeOperations = {
    async run(args) { calls.push(args.join(" ")); },
    async smoke(engine) { calls.push(`smoke ${engine}`); fail?.(engine, calls); },
  };
  return { calls, ops };
}
test("browser runtime follows every declared engine and retains WebKit OS dependencies in the matching image", () => {
  assert.deepEqual(browserRuntimePlan([]), { kind: "none", engines: [] });
  assert.deepEqual(browserRuntimePlan(["firefox", "chromium", "firefox"]), { kind: "host", engines: ["chromium", "firefox"] });
  assert.deepEqual(browserRuntimePlan(["chromium", "webkit"]), { kind: "image", engines: ["chromium", "webkit"] });
});
test("host setup verifies pinned binaries and launches all required engines even on a cache hit", async () => {
  const { calls, ops } = operations();
  await provisionBrowserRuntime(browserRuntimePlan(["chromium", "firefox"]), "1.56.1", ops);
  assert.deepEqual(calls, ["install chromium firefox", "smoke chromium", "smoke firefox"]);
});
test("only missing OS dependencies trigger engine-scoped installation followed by a complete launch proof", async () => {
  let first = true;
  const { calls, ops } = operations(() => { if (first) { first = false; throw Error("Host system is missing dependencies to run browsers."); } });
  await provisionBrowserRuntime(browserRuntimePlan(["chromium", "firefox"]), "1.56.1", ops);
  assert.deepEqual(calls, ["install chromium firefox", "smoke chromium", "install-deps chromium firefox", "smoke chromium", "smoke firefox"]);
});
test("download, unknown launch, and persistent dependency failures fail the gate", async () => {
  const download = operations();
  download.ops.run = async () => { throw Error("download failed"); };
  await assert.rejects(provisionBrowserRuntime(browserRuntimePlan(["firefox"]), "1.56.1", download.ops), /download failed/);
  const unknown = operations(() => { throw Error("browser crashed"); });
  await assert.rejects(provisionBrowserRuntime(browserRuntimePlan(["firefox"]), "1.56.1", unknown.ops), /browser crashed/);
  assert.deepEqual(unknown.calls, ["install firefox", "smoke firefox"]);
  const persistent = operations(() => { throw Error("missing.so: cannot open shared object file"); });
  await assert.rejects(provisionBrowserRuntime(browserRuntimePlan(["firefox"]), "1.56.1", persistent.ops), /missing.so/);
});
test("image and no-browser setup never silently use a mismatched browser version", async () => {
  const { calls, ops } = operations();
  await provisionBrowserRuntime(browserRuntimePlan(["webkit"]), "1.56.1", ops);
  assert.deepEqual(calls, ["image"]);
  await provisionBrowserRuntime(browserRuntimePlan([]), "1.56.1", ops);
  assert.deepEqual(calls, ["image"]);
  await assert.rejects(provisionBrowserRuntime(browserRuntimePlan(["firefox"]), "other", ops), /matching/);
});
