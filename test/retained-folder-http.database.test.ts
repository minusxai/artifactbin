import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { database } from "../src/database.js";
import { createService } from "../src/server.js";
import { createRetainedFolderExecutor } from "../src/migration/folder-title-apply.ts";
import { planFolderTitles } from "../src/migration/folder-title-plan.ts";
import { insertPages } from "./fixtures/pages.js";
import { hash } from "../src/server/text.ts";
import type { RetainedFolderRegistration } from "../src/retained-folders/contracts.ts";
const policy = (visibility: "public" | "unlisted" | "private") => ({
  visibility,
  linkRole: "viewer" as const,
  shares: {},
  version: 1,
});

test("retained folder HTTP renders escaped readable links, hides private children, and serves consistent HEAD", async () => {
  const env = await testDatabase(),
    store = database(env),
    http = createService(env);
  try {
    await store.health();
    await insertPages(env.pool, {
      accounts: { owner: {} },
      tokens: {
        [hash("owner-token")]: { actor: "owner", expires: Date.now() + 60000 },
        [hash("expired")]: { actor: "owner", expires: 0 },
        [hash("scoped")]: {
          actor: "owner",
          fileId: "PUB123",
          expires: Date.now() + 60000,
        },
      },
      files: {
        PUB123: {
          owner: "owner",
          head: "1",
          path: "/imported/old/child/public.html",
          access: policy("public"),
          sources: { "1": "<title>Page &lt;unsafe&gt;</title>" },
        },
        PRV123: {
          owner: "owner",
          head: "1",
          path: "/imported/old/child/private.html",
          access: policy("private"),
          sources: { "1": "<title>Private secret</title>" },
        },
        UNL123: {
          owner: "owner",
          head: "1",
          path: "/imported/old/child/unlisted.html",
          access: policy("unlisted"),
          sources: { "1": "<title>Unlisted secret</title>" },
        },
      },
    });
    const records: RetainedFolderRegistration[] = [
      {
        descriptor: {
          namespace: "fixture",
          legacyId: "PAR123",
          owner: "owner",
          title: "Parent <tag>",
          expectedPath: "/imported/old",
          ancestorIds: [],
          sourceRevision: "1",
          deleted: false,
        },
        access: policy("unlisted"),
      },
      {
        descriptor: {
          namespace: "fixture",
          legacyId: "FLD123",
          owner: "owner",
          title: 'Folder <script>alert("x")</script> & friends',
          expectedPath: "/imported/old/child",
          ancestorIds: ["PAR123"],
          sourceRevision: "1",
          deleted: false,
        },
        access: policy("public"),
      },
    ];
    const plan = planFolderTitles(
      records.map((row) => row.descriptor),
      { owner: await store.paths.paths("owner") },
    );
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    await createRetainedFolderExecutor(store.sql)(plan, records);
    await new Promise<void>((resolve) =>
      http.server.listen(0, "127.0.0.1", resolve),
    );
    const origin =
      "http://127.0.0.1:" + (http.server.address() as { port: number }).port;
    assert.equal(
      (await fetch(origin + "/a/PUB123", { redirect: "manual" })).status,
      200,
    );
    assert.equal(
      (
        await fetch(origin + "/a/PUB123", {
          headers: { Cookie: "pagegi_account=expired" },
          redirect: "manual",
        })
      ).status,
      200,
    );
    for (const token of ["expired", "scoped"])
      for (const method of ["GET", "HEAD"])
        assert.equal(
          (
            await fetch(origin + "/a/FLD123", {
              method,
              headers: { Cookie: "pagegi_account=" + token },
            })
          ).status,
          200,
        );
    const attempted = await fetch(origin + "/api/publish", {
      method: "POST",
      headers: {
        Authorization: "Bearer owner-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source:
          '<!doctype html><html><head><script type="application/json" data-af="meta">{"id":"FLD123"}</script></head><body>Refused</body></html>',
        requestId: "folder-claim",
        visibility: "public",
      }),
    });
    assert.equal(attempted.status, 422);
    assert.ok((await attempted.text()).includes("meta block names ID"));
    const response = await fetch(origin + "/a/FLD123");
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(
      body.includes(
        "Folder &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; friends",
      ),
    );
    assert.ok(body.includes("Parent &lt;tag&gt;"));
    assert.ok(body.includes('href="/a/PAR123"'));
    assert.ok(body.includes('href="/a/PUB123"'));
    assert.ok(body.includes("Page &lt;unsafe&gt;"));
    assert.ok(!body.includes("<script>"));
    for (const secret of [
      "Private secret",
      "Unlisted secret",
      "PRV123",
      "UNL123",
      "/imported/",
      "owner-token",
      "sourceRevision",
    ])
      assert.ok(!body.includes(secret));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const head = await fetch(origin + "/a/FLD123", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    for (const name of [
      "content-type",
      "content-length",
      "cache-control",
      "content-security-policy",
    ])
      assert.equal(head.headers.get(name), response.headers.get(name));
    const owned = await fetch(origin + "/a/FLD123", {
      headers: { Cookie: "pagegi_account=owner-token" },
    });
    assert.ok((await owned.text()).includes('href="/a/PRV123"'));
    assert.equal(
      (await fetch(origin + "/a/FLD123?namespace=other")).status,
      404,
    );
    assert.equal(
      (await fetch(origin + "/a/FLD123", { method: "POST" })).status,
      404,
    );
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='PAR123'",
      [JSON.stringify(policy("private"))],
    );
    const hiddenParent = await (await fetch(origin + "/a/FLD123")).text();
    assert.ok(!hiddenParent.includes("Parent &lt;tag&gt;"));
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='PAR123'",
      [JSON.stringify(policy("unlisted"))],
    );
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='FLD123'",
      [JSON.stringify(policy("unlisted"))],
    );
    const unlisted = await (await fetch(origin + "/a/FLD123")).text();
    assert.ok(unlisted.includes('href="/a/PAR123"'));
    assert.ok(!unlisted.includes('href="/a/UNL123"'));
    assert.ok(unlisted.includes('href="/a/PUB123"'));
    await env.pool.query(
      "UPDATE retained_folders SET access=$1::jsonb WHERE legacy_id='FLD123'",
      [JSON.stringify(policy("private"))],
    );
    for (const method of ["GET", "HEAD"])
      assert.equal(
        (await fetch(origin + "/a/FLD123", { method, redirect: "manual" }))
          .status,
        404,
      );
    for (const token of ["expired", "scoped"])
      for (const method of ["GET", "HEAD"])
        assert.equal(
          (
            await fetch(origin + "/a/FLD123", {
              method,
              headers: { Cookie: "pagegi_account=" + token },
            })
          ).status,
          404,
        );
    await env.pool.query(
      "UPDATE retained_folders SET state='deleted',path=NULL WHERE legacy_id='FLD123'",
    );
    assert.equal(
      (
        await fetch(origin + "/a/FLD123", {
          headers: { Cookie: "pagegi_account=owner-token" },
        })
      ).status,
      404,
    );
  } finally {
    await http.close();
    await new Promise<void>((resolve) => http.server.close(() => resolve()));
    await store.close();
    await env.cleanup();
  }
});
