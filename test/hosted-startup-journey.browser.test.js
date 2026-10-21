import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  hostedShell,
  hostedStartupScriptPolicy,
  serveRunner,
} from "../src/hosted.js";
import { initialState } from "../src/document.js";

const source =
  '<!doctype html><html><head><title>Startup fixture</title></head><body><h1 data-af-id="title">Document is ready</h1></body></html>';
let origin, runnerOrigin;
const runner = createServer((req, res) =>
  serveRunner(req, res, origin, runnerOrigin),
);
await new Promise((r) => runner.listen(0, "127.0.0.1", r));
runnerOrigin = `http://127.0.0.1:${runner.address().port}`;
const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/context") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' ${hostedStartupScriptPolicy}; style-src 'self' 'unsafe-inline'; frame-src ${runnerOrigin}; base-uri 'none'; object-src 'none'`,
    );
    return res.end(
      hostedShell({
        title: "Startup fixture",
        boot: {
          stateUrl: req.url === "/context" ? "/context-state" : "/state",
          sourceUrl: "/source",
          runner: runnerOrigin + "/runner",
        },
      }),
    );
  }
  if (req.url === "/state" || req.url === "/context-state") {
    res.setHeader("Content-Type", "application/json");
    const state = initialState(source);
    if (req.url === "/context-state") state.contextOnly = true;
    return res.end(JSON.stringify({ source, state }));
  }
  if (req.url === "/source") return res.end(source);
  if (["/runtime.js", "/trusted-connection.js"].includes(req.url)) {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(await readFile("dist" + req.url));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
origin = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let releaseRuntime, releaseState, releaseRunner;
  const runtimeGate = new Promise((r) => (releaseRuntime = r));
  const stateGate = new Promise((r) => (releaseState = r));
  const runnerGate = new Promise((r) => (releaseRunner = r));
  let runtimeRequests = 0,
    markState;
  const stateRequested = new Promise((r) => (markState = r));
  await page.route("**/runtime.js", async (route) => {
    runtimeRequests++;
    await runtimeGate;
    await route.continue();
  });
  await page.route("**/state", async (route) => {
    markState();
    await stateGate;
    await route.continue();
  });
  await page.route("**/runner.js", async (route) => {
    await runnerGate;
    await route.continue();
  });
  await page.goto(origin, { waitUntil: "commit" });
  const panel = page.locator("#pg-startup");
  await panel.waitFor({ state: "visible" });
  assert.equal(await page.locator("#pg-frame").isVisible(), false);
  assert.match(await panel.innerText(), /Loading document/);
  releaseRuntime();
  await page.waitForFunction(() => document.readyState !== "loading");
  await stateRequested;
  assert.equal(runtimeRequests, 1);
  releaseState();
  await page.waitForRequest("**/runner.js");
  assert.equal(await panel.isVisible(), true);
  assert.equal(await page.locator("#pg-frame").isVisible(), false);
  releaseRunner();
  await panel.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .frameLocator("#pg-frame")
      .getByRole("heading", { name: "Document is ready" })
      .isVisible(),
    true,
  );
  assert.equal(
    await page.locator("link[rel=alternate]").getAttribute("href"),
    "/source",
  );
  await page.close();

  const contextPage = await browser.newPage();
  const contextErrors = [];
  contextPage.on("pageerror", (error) => contextErrors.push(error.message));
  await contextPage.goto(origin + "/context");
  await contextPage.locator("#pg-startup").waitFor({ state: "hidden" });
  assert.equal(
    await contextPage
      .frameLocator("#pg-history")
      .getByRole("heading", {
        name: "Document is ready",
      })
      .isVisible(),
    true,
  );
  assert.equal(
    await contextPage.locator("#pg-history").getAttribute("sandbox"),
    "",
  );
  assert.equal(
    await contextPage.locator("#pg-frame").getAttribute("src"),
    null,
  );
  assert.deepEqual(contextErrors, []);
  await contextPage.close();

  for (const failed of ["/runtime.js", "/state", "/runner.js"]) {
    const failure = await browser.newPage();
    await failure.route("**" + failed, (route) => route.abort());
    if (failed === "/runner.js") await failure.clock.install();
    await failure.goto(origin, { waitUntil: "domcontentloaded" });
    if (failed === "/runner.js") await failure.clock.fastForward(31000);
    await failure.getByRole("alert").waitFor();
    assert.match(
      await failure.getByRole("alert").innerText(),
      /Document could not finish loading/,
    );
    assert.equal(
      await failure.getByRole("button", { name: "Try again" }).isVisible(),
      true,
    );
    assert.equal(await failure.locator("#pg-frame").isVisible(), false);
    await failure.close();
  }
  console.log(
    "Hosted startup: delayed runtime, state and runner, first app view, and failures passed",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  runner.closeAllConnections();
  await Promise.all([
    new Promise((r) => server.close(r)),
    new Promise((r) => runner.close(r)),
  ]);
}
