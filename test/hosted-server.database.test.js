import WebSocket from "ws";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { request as httpRequest } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { createService, addAccount } from "../src/server.js";
test("hosted shell discovers protected canonical source, private runner is empty and isolated per document", async () => {
  const db = await testDatabase();
  await addAccount(db, "alice", "correct horse battery");
  const service = createService(db);
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const request = (path, token, body, extra = {}) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const login = await (
      await request("/api/login", null, {
        username: "alice",
        password: "correct horse battery",
      })
    ).json();
    const token = login.token;
    const source =
      '<!doctype html><html><head><title>Private source</title></head><body><h1>Private needle</h1></body></html>';
    const files = [];
    for (const requestId of ["hosted-one", "hosted-two"])
      files.push(
        await (
          await request("/api/publish", token, {
            source,
            requestId,
            visibility: "private",
            linkRole: "viewer",
          })
        ).json(),
      );
    const shells = [];
    for (const file of files) {
      assert.ok(file.id, JSON.stringify(file));
      const paths = await (await request("/api/paths", token)).json();
      const entry = paths.entries.find((x) => x.fileId === file.id);
      const shell = await request(new URL(entry.url).pathname, token);
      assert.equal(shell.status, 200);
      const html = await shell.text();
      assert.match(
        shell.headers.get("content-security-policy"),
        /frame-src 'self' http/,
      );
      assert.ok(!html.includes("Private needle"));
      assert.ok(!html.includes(token));
      const parsed = parse(html);
      const head = parsed.childNodes
        .find((node) => node.tagName === "html")
        .childNodes.find((node) => node.tagName === "head");
      const scripts = head.childNodes.filter(
        (node) =>
          node.tagName === "script" &&
          node.attrs.some((attr) => attr.name === "src"),
      );
      assert.deepEqual(
        scripts.map(
          (node) => node.attrs.find((attr) => attr.name === "src").value,
        ),
        ["/trusted-connection.js", "/runtime.js"],
        "trusted connection must load before the runtime in the platform head",
      );
      const body = parsed.childNodes
        .find((node) => node.tagName === "html")
        .childNodes.find((node) => node.tagName === "body");
      const startupScript = body.childNodes.find(
        (node) => node.tagName === "script",
      );
      const startupHash = createHash("sha256")
        .update(
          startupScript.childNodes.map((node) => node.value || "").join(""),
        )
        .digest("base64");
      const scriptPolicy = shell.headers
        .get("content-security-policy")
        .split(";")
        .find((directive) => directive.trim().startsWith("script-src"));
      assert.equal(
        scriptPolicy.trim(),
        `script-src 'self' 'sha256-${startupHash}'`,
      );
      for (const script of scripts) {
        assert.ok(script.attrs.some((attr) => attr.name === "defer"));
        assert.ok(!script.attrs.some((attr) => attr.name === "async"));
      }
      const trustedScript = await request("/trusted-connection.js");
      assert.equal(trustedScript.status, 200);
      assert.match(trustedScript.headers.get("content-type"), /javascript/);
      const trustedCode = await trustedScript.text();
      assert.ok(!trustedCode.includes("Private needle"));
      assert.ok(!trustedCode.includes(token));
      const boot = JSON.parse(
        /<script id="pagegi-host" type="application\/json">([^<]+)<\/script>/.exec(
          html,
        )[1],
      );
      shells.push(boot);
      assert.equal(boot.fileId, file.id);
      assert.equal(boot.token, undefined);
      assert.match(shell.headers.get("link"), /rel="alternate"/);
      const denied = await request(boot.sourceUrl);
      assert.notEqual(denied.status, 200);
      assert.equal(denied.headers.get("etag"), null);
      const sourceResponse = await request(boot.sourceUrl, token);
      assert.equal(sourceResponse.status, 200);
      assert.match(sourceResponse.headers.get("content-type"), /text\/plain/);
      assert.equal(sourceResponse.headers.get("etag"), '"1"');
      assert.equal(await sourceResponse.text(), file.source);
      const cookie = await request(boot.sourceUrl, null, null, {
        Cookie: `pagegi_account=${token}`,
      });
      assert.equal(cookie.status, 200);
      const stateResponse = await request(boot.stateUrl, token);
      const state = await stateResponse.json();
      assert.equal(state.source, file.source);
      assert.equal(state.state.fileId, file.id);
      assert.ok(state.boot.token);
      assert.notEqual(state.boot.token, token);
      const runner = await fetch(boot.runner);
      assert.equal(runner.status, 200);
      const runnerHtml = await runner.text();
      assert.ok(!runnerHtml.includes("Private needle"));
      assert.ok(!runnerHtml.includes(token));
      assert.match(runnerHtml, /data-platform-origin=/);
      const runnerOrigin = new URL(boot.runner).origin;
      assert.notEqual(new URL(runnerOrigin).hostname, new URL(origin).hostname);
      for (const path of [
        "/trusted-connection.js",
        "/api/library",
        "/api/library/" + file.id + "/source",
        "/",
      ])
        assert.equal((await fetch(runnerOrigin + path)).status, 404);
      const download = await request(
        "/api/library/" + file.id + "/download",
        token,
        null,
        { "X-Pagegi-Home": "1" },
      );
      const packed = await download.text();
      assert.ok(!packed.includes(token));
      assert.match(packed, /<script data-af="core" data-af-server="[^"]+" data-af-revision="[^"]+">/);
      assert.match(packed, /Private needle/);
      const changed = await fetch(origin + "/api/files/" + file.id + "/source", {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "If-Match": '"1"',
        },
        body: JSON.stringify({ source: file.source + "<!-- next -->" }),
      });
      assert.equal(changed.status, 200);
      assert.equal(
        (await request(boot.sourceUrl, token)).headers.get("etag"),
        '"2"',
      );
    }
    assert.notEqual(
      new URL(shells[0].runner).origin,
      new URL(shells[1].runner).origin,
    );
    const socketOutcome = (host) =>
      new Promise((resolve) => {
        const ws = new WebSocket(
          origin.replace("http:", "ws:") +
            "/api/files/" +
            files[0].id +
            "/live",
          { headers: { Host: host } },
        );
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("error", () => resolve("denied"));
      });
    assert.equal(await socketOutcome(new URL(origin).host), "open");
    assert.equal(await socketOutcome("evil.example"), "denied");
    const spoof = await new Promise((resolve, reject) => {
      const req = httpRequest(
        origin + "/health",
        { headers: { Host: "evil.example", "X-Forwarded-Proto": "https" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(spoof, 403);
  } finally {
    service.server.closeAllConnections();
    await new Promise((r) => service.server.close(r));
    await service.close();
    await db.cleanup();
  }
});
test("configured runner host exposes only empty bootstrap and denies platform HTTP/WebSocket surfaces", async () => {
  const db = await testDatabase();
  const service = createService({
    ...db,
    platformOrigin: "https://platform.example",
    runnerOrigin: "https://{document}.apps.example",
  });
  await new Promise((r) => service.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const call = (host, path, method = "GET") =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        origin + path,
        { method, headers: { Host: host } },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
  try {
    assert.equal((await call("platform.example", "/health")).status, 200);
    const runner = await call("doc-a.apps.example", "/runner");
    assert.equal(runner.status, 200);
    assert.match(
      runner.body,
      /data-platform-origin="https:\/\/platform.example"/,
    );
    assert.equal(
      (await call("doc-a.apps.example", "/api/library")).status,
      404,
    );
    assert.equal(
      (await call("doc-a.apps.example", "/api/files/Pg4mQ2/source")).status,
      404,
    );
    assert.equal(
      (await call("evil.example", "/health", "OPTIONS")).status,
      403,
    );
    const wsResult = await new Promise((resolve) => {
      const ws = new WebSocket(
        origin.replace("http:", "ws:") + "/api/files/Pg4mQ2/live",
        { headers: { Host: "doc-a.apps.example" } },
      );
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("error", () => resolve("denied"));
    });
    assert.equal(wsResult, "denied");
  } finally {
    service.server.closeAllConnections();
    await new Promise((r) => service.server.close(r));
    await service.close();
    await db.cleanup();
  }
});
