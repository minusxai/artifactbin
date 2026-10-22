/**
 * GET /@<handle> shows the account's photo, the one identity field the earlier
 * product's anonymous profile exposed, and never its name or email; the
 * public-only page list is unchanged by the photo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { page, startServer, type TestServer } from "../support/server.ts";

const PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** A browser session cookie for the home routes, the way the Account page signs in. */
async function homeSession(
  server: TestServer,
  email: string,
): Promise<Record<string, string>> {
  const response = await server.request("/api/auth/test-token", {
    method: "POST",
    body: { email, browserSession: true },
    headers: { Origin: server.origin },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "browser session cookie");
  return { Cookie: cookie, Origin: server.origin, "X-Pagegi-Home": "1" };
}

test("a public profile shows the account's photo when it has one, never its name, and keeps listing public pages only", async () => {
  const server = await startServer();
  try {
    const email = "profile-photo@example.test";
    const token = await server.token(email);
    const home = await homeSession(server, email);
    assert.equal(
      (
        await server.request("/api/account/handle", {
          method: "PUT",
          token,
          body: { handle: "carol" },
        })
      ).status,
      200,
    );
    const publish = async (title: string, visibility: string) => {
      const response = await server.request("/api/publish", {
        token,
        body: {
          source: page("<h1>" + title + "</h1>").replace(
            "<title>Test page</title>",
            "<title>" + title + "</title>",
          ),
          requestId: title,
          visibility,
        },
      });
      assert.equal(response.status, 201);
      return (await response.json()).id as string;
    };
    const shown = await publish("Shown public", "public");
    await publish("Hidden private", "private");

    // No photo yet: no image, no image policy.
    let response = await server.request("/@carol");
    assert.equal(response.status, 200);
    let html = await response.text();
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(
      response.headers.get("content-security-policy")!,
      /img-src/,
    );
    assert.match(html, new RegExp("/a/" + shown));
    assert.doesNotMatch(html, /Hidden private|profile-photo@/);

    // The Account page saves a name and a photo; only the photo is public.
    const saved = await server.request("/api/library/profile", {
      method: "POST",
      headers: home,
      body: { name: "Carol Danvers", image: PHOTO },
    });
    assert.equal(saved.status, 200, await saved.text());
    response = await server.request("/@carol");
    assert.equal(response.status, 200);
    html = await response.text();
    assert.match(
      html,
      new RegExp(
        '<img class="profile-photo" src="' +
          PHOTO.replace(/[+/]/g, "\\$&") +
          '" alt=""',
      ),
    );
    assert.match(
      response.headers.get("content-security-policy")!,
      /img-src data:/,
    );
    assert.doesNotMatch(html, /Carol|Danvers|profile-photo@/);
    assert.match(html, new RegExp("/a/" + shown));
    assert.doesNotMatch(html, /Hidden private/);
    const head = await server.request("/@carol", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.match(head.headers.get("content-security-policy")!, /img-src data:/);
    assert.equal(await head.text(), "");

    // Removing the photo removes it from the profile at once.
    assert.equal(
      (
        await server.request("/api/library/profile", {
          method: "POST",
          headers: home,
          body: { name: "Carol Danvers", image: null },
        })
      ).status,
      200,
    );
    response = await server.request("/@carol");
    assert.doesNotMatch(await response.text(), /<img/);
    assert.doesNotMatch(
      response.headers.get("content-security-policy")!,
      /img-src/,
    );
  } finally {
    await server.close();
  }
});
