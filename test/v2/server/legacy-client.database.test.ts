/**
 * The server answers the earlier product's client paths before any other
 * route, for every method and with or without credentials, and never on the
 * runner origin's behalf for the new API (http-api.md, "Legacy clients").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../support/server.ts";
import { INSTALLER_ARCHIVE_PATH } from "../../../src/server/installer-archive-contracts.ts";

test("legacy CLI and skill paths are 410 for any method, signed in or not, and the new API is untouched", async () => {
  const server = await startServer();
  try {
    const token = await server.token("legacy@example.test");
    for (const [method, path] of [
      ["GET", "/api/artifacts"],
      ["POST", "/api/artifacts"],
      ["GET", "/api/artifacts/Ab12Cd"],
      ["PUT", "/api/artifacts/Ab12Cd/source"],
      ["DELETE", "/api/artifacts/Ab12Cd"],
      ["POST", "/oauth/device"],
      ["POST", "/oauth/token"],
    ] as const) {
      for (const headers of [{}, { Authorization: `Bearer ${token}` }] as Record<string, string>[]) {
        const response = await fetch(server.origin + path, { method, headers, body: method === "GET" ? undefined : "{}" });
        assert.equal(response.status, 410, `${method} ${path}`);
        const body = (await response.json()) as { error: string; message: string; hint: string };
        assert.equal(body.error, "server_migrated", `${method} ${path}`);
        assert.ok(body.hint.includes(`npx ${server.origin}${INSTALLER_ARCHIVE_PATH}`), `${method} ${path} names this server's installer`);
      }
    }
    for (const path of ["/llms.txt", "/llms/http-auth", "/chat/install.sh", "/chat/install-node.sh"]) {
      const response = await fetch(server.origin + path);
      assert.equal(response.status, 410, path);
      assert.match(response.headers.get("content-type") ?? "", /text\/plain/, path);
      assert.match(await response.text(), /npx /, path);
    }
    const installer = await fetch(server.origin + INSTALLER_ARCHIVE_PATH, { method: "HEAD" });
    assert.equal(installer.status, 200, "the installer the hint names is served");
    const publish = await server.request("/api/publish", { token, body: {} });
    assert.equal(publish.status, 422, "the new API still validates its own requests");
  } finally {
    await server.close();
  }
});
