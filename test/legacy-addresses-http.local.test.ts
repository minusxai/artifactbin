import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { serveLegacyAddress } from "../src/server/legacy-addresses-http.ts";

test("legacy HTTP composition keeps raw source inert and strips CORS on success, denial and invalid selectors", async () => {
  const source = '<h1 data-af-id="n1">Saved</h1><script>untrusted()</script>';
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      const handled = await serveLegacyAddress(
        req,
        res,
        new URL(req.url!, "http://example.test"),
        String(req.headers.authorization ?? ""),
        {
          raw: {
            async read(_id, credential) {
              return credential === "allowed"
                ? { kind: "document", source }
                : null;
            },
          },
          media: {
            async read() {
              throw Error("not media");
            },
          },
        },
        async (next, id) => {
          calls.push(id + next.search);
          res.writeHead(200);
          res.end("normal authorized page handler");
        },
      );
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      res.writeHead((error as { status?: number }).status ?? 500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    for (const [suffix, status, auth] of [
      ["", 200, "allowed"],
      ["", 404, ""],
      ["?version=0", 400, "allowed"],
    ] as const) {
      const result = await fetch(origin + "/a/Ab1Cd2/raw" + suffix, {
        headers: { Authorization: auth },
      });
      assert.equal(result.status, status);
      assert.equal(result.headers.get("access-control-allow-origin"), null);
      assert.match(result.headers.get("content-security-policy")!, /sandbox/);
      assert.equal(await result.text(), status === 200 ? source : "");
    }
    const head = await fetch(origin + "/a/Ab1Cd2/raw", {
      method: "HEAD",
      headers: { Authorization: "allowed" },
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(
      head.headers.get("content-length"),
      String(Buffer.byteLength(source)),
    );
    const wrong = await fetch(origin + "/a/Ab1Cd2/raw", { method: "POST" });
    assert.equal(wrong.status, 404);
    await fetch(origin + "/a/Ab1Cd2/download?version=3");
    await fetch(origin + "/workspace/Ab1Cd2?version=2");
    assert.deepEqual(calls, [
      "Ab1Cd2?version=3&download=1",
      "Ab1Cd2?version=2",
    ]);
    const unknown = await fetch(origin + "/a/Ab1Cd2/other");
    assert.equal(unknown.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
