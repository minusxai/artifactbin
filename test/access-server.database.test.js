import { test } from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server.js";
import { testDatabase } from "./postgres.js";
test("private invitations, link roles, public discovery and concurrent sharing writes enforce one policy", async () => {
  const db = await testDatabase(),
    codes = new Map();
  const s = createService({
    ...db,
    sendCode: async (m) => codes.set(m.to, m.code),
  });
  await new Promise((r) => s.server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + s.server.address().port;
  const req = async (
    path,
    token,
    body,
    method = body ? "POST" : "GET",
    extra = {},
  ) => {
    const r = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        "Content-Type": "application/json",
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const text = await r.text();
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? JSON.parse(text)
        : text,
      headers: r.headers,
    };
  };
  const login = async (email) => {
    await req("/api/auth/email/request", null, { email });
    return (
      await req("/api/auth/email/verify", null, {
        email,
        code: codes.get(email),
      })
    ).data.token;
  };
  try {
    const owner = await login("owner@example.com"),
      reader = await login("reader@example.com"),
      editor = await login("editor@example.com");
    const pub = (
        await req("/api/publish", owner, {
          source: "<title>Shared</title><h1>Hello</h1>",
          requestId: "acl",
          visibility: "private",
        })
      ).data,
      base = "/api/files/" + pub.id,
      link = new URL(pub.url).pathname;
    let sharing = await req(base + "/sharing", owner);
    assert.equal(sharing.status, 200);
    assert.equal(sharing.data.policy.visibility, "private");
    const patch = async (body) => {
      const r = await req(base + "/sharing", owner, body, "PUT", {
        "If-Match": String(sharing.data.policy.version),
      });
      if (r.status === 200) sharing = r;
      return r;
    };
    assert.equal((await req(base + "/sharing", reader)).status, 403);
    assert.equal(
      (await patch({ email: "reader@example.com", role: "viewer" })).status,
      200,
    );
    assert.equal((await req(base + "/source", reader)).status, 200);
    assert.equal(
      (await req(base + "/comments", reader, { comment: {} })).status,
      403,
    );
    assert.equal(
      (await req(base + "/source", reader, { source: "no" }, "PUT")).status,
      403,
    );
    assert.equal(
      (await req(link, null)).status,
      302,
      "private link asks anonymous visitor to sign in",
    );
    const page = await req(link, null, null, "GET", {
      Cookie: "pagegi_account=" + reader,
    });
    assert.equal(page.status, 200);
    const entries = await req("/api/library", null, null, "GET", {
      "X-Pagegi-Home": "1",
      Cookie: "pagegi_account=" + reader,
    });
    assert.equal(entries.data.sharedFiles[0].fileId, pub.id);
    await patch({ email: "editor@example.com", role: "editor" });
    assert.equal((await req(base + "/sharing", editor)).status, 200);
    const editorSharing = await req(base + "/sharing", editor);
    assert.equal(editorSharing.data.permissions.edit, true);
    assert.equal(editorSharing.data.permissions.manage, false);
    assert.deepEqual(editorSharing.data.policy.shares, {});
    assert.equal(
      (
        await req(base + "/sharing", editor, { visibility: "public" }, "PUT", {
          "If-Match": String(sharing.data.policy.version),
        })
      ).status,
      403,
    );
    assert.equal((await req(base + "/revoke", editor, {})).status, 403);
    assert.equal((await req(base, editor, null, "DELETE")).status, 404);
    const editable = await req(base + "/source", editor);
    assert.equal(editable.status, 200);
    assert.equal(
      (
        await req(
          base + "/source",
          editor,
          { source: editable.data.source },
          "PUT",
          {
            "If-Match": editable.headers.get("etag"),
          },
        )
      ).status,
      200,
      "an invited editor can still publish page source externally",
    );
    const ownerPaths = await req("/api/paths", owner);
    const original = ownerPaths.data.entries.find(
      (entry) => entry.fileId === pub.id,
    );
    assert.ok(original);
    assert.equal(
      (
        await req("/api/paths", editor, {
          kind: "move",
          from: original.path,
          path: "/moved.html",
        })
      ).status,
      404,
    );
    assert.equal(
      (await req("/api/paths", owner)).data.entries.find(
        (entry) => entry.fileId === pub.id,
      ).path,
      original.path,
    );
    const version = sharing.data.policy.version;
    const writes = await Promise.all(
      ["public", "unlisted"].map((visibility) =>
        req(base + "/sharing", owner, { visibility }, "PUT", {
          "If-Match": String(version),
        }),
      ),
    );
    assert.deepEqual(writes.map((r) => r.status).sort(), [200, 412]);
    sharing = await req(base + "/sharing", owner);
    await patch({ visibility: "public" });
    assert.equal((await req("/api/public")).data.files.length, 1);
    await patch({ visibility: "unlisted" });
    assert.equal((await req("/api/public")).data.files.length, 0);
    assert.equal((await req(link, null)).status, 200);
    await patch({ linkRole: "commenter" });
    assert.equal((await req(base + "/permissions", reader)).data.comment, true);
    await patch({ visibility: "private" });
    await patch({ email: "reader@example.com", role: null });
    assert.equal((await req(base + "/source", reader)).status, 403);
  } finally {
    await new Promise((r) => s.server.close(r));
    await s.close();
    await db.cleanup();
  }
});
