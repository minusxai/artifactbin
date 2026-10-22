import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { page, startServer } from "../support/server.ts";
test("public profiles paginate owner public pages only and follow current handles in a browser", async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    const token = await server.token("profile-owner@example.test");
    const other = await server.token("profile-other@example.test");
    assert.equal(
      (
        await server.request("/api/account/handle", {
          method: "PUT",
          token,
          body: { handle: "alice" },
        })
      ).status,
      200,
    );
    const publish = async (
      owner: string,
      title: string,
      visibility: string,
    ) => {
      const response = await server.request("/api/publish", {
        token: owner,
        body: {
          source: page("<h1>" + title + "</h1>"),
          requestId: title,
          visibility,
        },
      });
      assert.equal(response.status, 201);
      return (await response.json()).id as string;
    };
    const a = await publish(token, "Visible first", "public"),
      b = await publish(token, "Visible second", "public");
    await publish(token, "Hidden private", "private");
    await publish(token, "Hidden unlisted", "unlisted");
    await publish(other, "Other public", "public");
    const deleted = await publish(token, "Hidden deleted", "public");
    assert.equal(
      (
        await server.request("/api/files/" + deleted, {
          method: "DELETE",
          token,
        })
      ).status,
      200,
    );
    const first = await server.request("/@ALICE?limit=1");
    assert.equal(first.status, 200);
    const html = await first.text();
    assert.doesNotMatch(html, /Hidden|Other public|profile-owner@/);
    const ids = [a, b].sort();
    assert.match(html, new RegExp("/a/" + ids[0]));
    assert.doesNotMatch(html, new RegExp("/a/" + ids[1]));
    const next = await (
      await server.request("/@alice?limit=1&after=" + ids[0])
    ).text();
    assert.match(next, new RegExp("/a/" + ids[1]));
    assert.doesNotMatch(next, /Profile pages/);
    const tab = await browser.newPage();
    await tab.goto(server.origin + "/@alice");
    assert.equal(await tab.locator("h1").textContent(), "@alice");
    assert.equal(await tab.locator("main li a").count(), 2);
    assert.equal(
      (await server.request("/@alice", { method: "HEAD" })).status,
      200,
    );
    assert.equal(
      (
        await server.request("/api/account/handle", {
          method: "PUT",
          token,
          body: { handle: "alice-new" },
        })
      ).status,
      200,
    );
    assert.equal((await server.request("/@alice")).status, 404);
    assert.equal((await server.request("/@alice-new")).status, 200);
    assert.equal((await server.request("/@missing-person")).status, 404);
  } finally {
    await browser.close();
    await server.close();
  }
});
