import { preserveUnavailableHistoricalRevision } from "../../../src/migration/historical-unavailable.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startServer, page as sourcePage } from "../support/server.ts";
test("a saved-version URL shows old markup inertly while head stays live, and its download keeps the version", async () => {
  const server = await startServer(),
    browser = await chromium.launch();
  try {
    const token = await server.token();
    const first = await (
      await server.request("/api/publish", {
        token,
        body: {
          source: sourcePage(
            '<h1 id="marker">Saved one</h1><button id="mutate">Change</button><script>document.querySelector("#marker").textContent="Old script ran";document.querySelector("#mutate").onclick=()=>{document.querySelector("#marker").textContent="Changed";};</script>',
          ),
          requestId: "historical-browser",
          visibility: "public",
        },
      })
    ).json();
    assert.ok(first.id, JSON.stringify(first));
    const updated = await server.request(`/api/files/${first.id}/source`, {
      method: "PUT",
      token,
      headers: { "If-Match": "1" },
      body: {
        source: first.source
          .replace("Saved one", "Current two")
          .replace("Old script ran", "Head script ran"),
      },
    });
    assert.equal(updated.status, 200);
    const page = await browser.newPage(),
      errors: string[] = [],
      requests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (req) => requests.push(req.url()));
    await page.goto(`${server.origin}/a/${first.id}?version=1`);
    await page.waitForSelector("html[data-pagegi-startup=ready]", {
      state: "attached",
    });
    const saved = page.frameLocator("#pg-history");
    await saved.locator("#marker").waitFor();
    assert.equal(await saved.locator("#marker").textContent(), "Saved one");
    assert.equal(await saved.locator("script").count(), 0);
    assert.equal(await page.locator("#pg-history").getAttribute("sandbox"), "");
    await saved.locator("#mutate").click({ force: true });
    assert.equal(await saved.locator("#marker").textContent(), "Saved one");
    assert.ok(
      requests.includes(
        `${server.origin}/api/library/${first.id}/host?version=1`,
      ),
    );
    assert.ok(
      !requests.includes(`${server.origin}/api/library/${first.id}/host`),
    );
    await page
      .getByRole("button", { name: "Page settings", exact: true })
      .click();
    const downloading = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download HTML", exact: true })
      .click();
    const downloaded = await readFile(
      (await (await downloading).path())!,
      "utf8",
    );
    assert.match(downloaded, /Saved one/);
    assert.doesNotMatch(downloaded, /Current two/);
    assert.ok(
      requests.includes(`${server.origin}/a/${first.id}?download=1&version=1`),
    );
    const head = await browser.newPage();
    await head.goto(`${server.origin}/a/${first.id}`);
    await head.waitForSelector("html[data-pagegi-startup=ready]", {
      state: "attached",
    });
    await head.frameLocator("#pg-frame").locator("#marker").waitFor();
    assert.equal(
      await head.frameLocator("#pg-frame").locator("#marker").textContent(),
      "Head script ran",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("an imported unavailable historical notice stays selectable while its current page works", async () => {
  const server = await startServer(),
    browser = await chromium.launch();
  try {
    const token = await server.token();
    const archived = preserveUnavailableHistoricalRevision(
      { version: 1, format: "markup", source: "retired historical script" },
      {
        classification: "manual-blocked",
        html: null,
        issues: [{ code: "retired-script" }],
        identities: {},
      },
      "/af/v1/core.js",
    );
    const first = await (
      await server.request("/api/publish", {
        token,
        body: {
          source: archived.html,
          requestId: "imported-history",
          visibility: "public",
        },
      })
    ).json();
    assert.ok(first.id, JSON.stringify(first));
    assert.equal(
      (
        await server.request(`/api/files/${first.id}/source`, {
          method: "PUT",
          token,
          headers: { "If-Match": "1" },
          body: {
            source: sourcePage('<h1 id="current">Working current page</h1>'),
          },
        })
      ).status,
      200,
    );
    const page = await browser.newPage();
    await page.goto(`${server.origin}/a/${first.id}?version=1`);
    await page.waitForSelector("html[data-pagegi-startup=ready]", {
      state: "attached",
    });
    await page
      .frameLocator("#pg-history")
      .getByText("Historical version 1 unavailable", { exact: true })
      .waitFor();
    assert.equal(
      await page.frameLocator("#pg-history").locator("script").count(),
      0,
    );
    await page.goto(`${server.origin}/a/${first.id}`);
    await page.waitForSelector("html[data-pagegi-startup=ready]", {
      state: "attached",
    });
    await page
      .frameLocator("#pg-frame")
      .getByText("Working current page", { exact: true })
      .waitFor();
  } finally {
    await browser.close();
    await server.close();
  }
});
