import { test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { createService } from "../src/server.js";
test("browser sign-in lists only owned files; hosted/downloaded HTML shares the runtime without leaking account tokens; logout revokes session", async () => {
  const db = await testDatabase();
  let delivered;
  const service = createService({
    ...db,
    now: () => 1700000000000,
    sendCode: async (m) => {
      delivered = m;
    },
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const call = (path, body, cookie = "", extra = {}) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Pagegi-Home": "1",
        Origin: origin,
        Cookie: cookie,
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  async function login(email) {
    await call("/api/auth/email/request", { email });
    const r = await call("/api/auth/email/verify", {
      email,
      code: delivered.code,
      browserSession: true,
    });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("set-cookie"), /HttpOnly/);
    const value = await r.json();
    assert.equal(value.token, undefined);
    return r.headers.get("set-cookie").split(";")[0];
  }
  try {
    assert.equal((await call("/api/library")).status, 401);
    const a = await login("alice@example.com"),
      b = await login("bob@example.com");
    assert.deepEqual(
      (await (await call("/api/library", null, a)).json()).files,
      [],
    );
    assert.equal(
      (await call("/api/library/profile", { name: "Alice", image: null }, a))
        .status,
      200,
    );
    assert.deepEqual(
      await (await call("/api/library/profile", null, a)).json(),
      { name: "Alice", image: null },
    );
    assert.notEqual(
      (await (await call("/api/library/profile", null, b)).json()).name,
      "Alice",
    );
    assert.equal(
      (
        await call(
          "/api/library/profile",
          { name: "Bad", image: "data:image/svg+xml;base64,AAAA" },
          a,
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await call("/api/library/profile", { name: "Bad", image: null }, a, {
          Origin: "https://other.example",
        })
      ).status,
      403,
    );
    const created = await call(
      "/api/library",
      {
        source: "<!doctype html><title>My research</title><h1>Hello</h1>",
        requestId: "library-one",
        visibility: "private",
      },
      a,
    );
    assert.equal(created.status, 201);
    const file = await created.json();
    const profiles = await fetch(
      origin + `/api/files/${file.id}/profiles`,
      { headers: { Authorization: "Bearer " + a.split("=")[1] } },
    );
    const people = await profiles.json();
    const concurrentProfiles = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(origin + `/api/files/${file.id}/profiles`, {
          headers: { Authorization: "Bearer " + a.split("=")[1] },
        }),
      ),
    );
    assert.ok(concurrentProfiles.every((r) => r.status === 200));
    assert.equal(people["alice@example.com"].name, "Alice");
    assert.equal(people["bob@example.com"], undefined);
    assert.equal(
      (
        await fetch(origin + `/api/files/${file.id}/profiles`, {
          headers: { Authorization: "Bearer wrong" },
        })
      ).status,
      403,
    );
    const list = await (await call("/api/library", null, a)).json();
    assert.equal(list.files[0].title, "My research");
    assert.equal(
      (await (await call("/api/library", null, b)).json()).files.length,
      0,
    );
    assert.equal(
      (await call(`/af/v1/ids/${file.id}`, null, b)).status,
      404,
    );
    const deniedId = await fetch(origin + `/af/v1/ids/${file.id}`, {
      redirect: "manual",
      headers: { Cookie: b },
    });
    assert.equal(deniedId.status, 404);
    assert.equal(deniedId.headers.get("location"), null);
    const hosted = await (
      await call(`/af/v1/ids/${file.id}`, null, a)
    ).text();
    assert.ok(hosted.includes("pagegi-host"));
    assert.ok(!hosted.includes(a.split("=")[1]));
    const shellBoot = JSON.parse(
      /<script id="pagegi-host" type="application\/json">([^<]+)<\/script>/.exec(
        hosted,
      )[1],
    );
    assert.equal(shellBoot.fileId, file.id);
    assert.equal(shellBoot.token, undefined);
    const hostedState = await (await call(shellBoot.stateUrl, null, a)).json();
    assert.equal(hostedState.state.fileId, file.id);
    assert.ok(hostedState.boot.token);
    const download = await call(
      `/api/library/${file.id}/download`,
      null,
      a,
    );
    const html = await download.text();
    assert.match(download.headers.get("content-disposition"), /attachment/);
    assert.ok(!html.includes('id="pagegi-host"'));
    assert.ok(!html.includes(a.split("=")[1]), "downloads never carry account tokens");
    assert.match(html, /<script data-af="core" data-af-server="[^"]+" data-af-revision="[^"]+">/);
    const denied = await call(
      "/api/library",
      { source: "<h1>bad</h1>", requestId: "csrf" },
      a,
      { Origin: "https://elsewhere.example" },
    );
    assert.equal(denied.status, 403);
    // A downloaded file carries its state; publishing it again seeds a new page with that state.
    const upload = {
      html:
        '<!doctype html><html><head><title>Offline notes</title><script type="application/json" data-af="state">{ "count": 4 }</script></head><body><h1>Notes</h1></body></html>',
      requestId: "portable-upload",
    };
    const imports = await Promise.all([
      call("/api/library", upload, a),
      call("/api/library", upload, a),
    ]);
    const imported = await imports[0].json();
    assert.equal((await imports[1].json()).id, imported.id);
    const exported = await (
      await call(`/api/library/${imported.id}/download`, null, a)
    ).text();
    assert.match(exported, /<script type="application\/json" data-af="state">[^<]*"count":\s*4/);
    await call("/api/library/logout", {}, a);
    assert.equal((await call("/api/library", null, a)).status, 401);
  } finally {
    await service.close();
    await new Promise((r) => service.server.close(r));
    await db.cleanup();
  }
});
