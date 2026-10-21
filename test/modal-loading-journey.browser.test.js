import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { homePage } from "../src/home-page.js";
let profileRequests = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    if (path.endsWith("/profile")) {
      profileRequests++;
      return; // An unrelated profile resource is stalled.
    }
    return res.end(
      JSON.stringify(
        path.endsWith("/sharing")
          ? {
              policy: {
                visibility: "private",
                linkRole: "viewer",
                shares: {},
                version: 1,
              },
              permissions: { manage: true },
              owner: "owner@example.test",
              url: "/f/example",
            }
          : { username: "owner@example.test" },
      ),
    );
  }
  if (path === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(homePage);
  }
  res.setHeader("Content-Type", "text/javascript");
  if (path === "/home.js") return res.end(await readFile("dist/home.js"));
  const browserFiles = ["account.js", "sharing.js", "identity.js"];
  res.end(
    await readFile(
      `src/${browserFiles.includes(path.slice(1)) ? "browser/" : ""}${path.slice(1)}`,
    ),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let releaseHome;
  const homeHeld = new Promise((resolve) => {
    releaseHome = resolve;
  });
  const starts = [];
  await page.route("**/*.js", async (route) => {
    const name = new URL(route.request().url()).pathname;
    starts.push(name);
    if (name === "/home.js") await homeHeld;
    await route.continue();
  });
  await page.setContent(
    `<iframe src="${origin}/?sharing=example&embed=1"></iframe>`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForFunction(
    () => document.querySelector("iframe").contentWindow !== null,
  );
  try {
    await assert.doesNotReject(async () => {
      const deadline = performance.now() + 1000;
      while (
        !starts.includes("/sharing.js") &&
        performance.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert(
        starts.includes("/sharing.js"),
        "Sharing module preload starts while bundled home entry is still pending",
      );
    });
    assert(starts.includes("/home.js"));
  } finally {
    releaseHome();
  }
  const start = performance.now();
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "Private", exact: true })
    .waitFor({ timeout: 2000 });
  assert.equal(
    profileRequests,
    0,
    "Sharing does not need account profile data",
  );
  console.log(
    `Embedded sharing ready in ${Math.round(performance.now() - start)}ms with profile stalled`,
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
