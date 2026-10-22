import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer, page } from "../support/server.ts";
import { compileOnlyHost } from "../support/todo.ts";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
for (const race of ["revoked session", "advanced head"] as const) {
  test(`save compilation holds no database transaction and refuses ${race}`, async () => {
    const entered = gate(),
      resume = gate(),
      host = compileOnlyHost();
    let pending: Promise<Response> | undefined;
    const server = await startServer({
      backendHost: {
        ...host,
        compile: async (...args) => {
          entered.release();
          await resume.promise;
          return host.compile(...args);
        },
      },
    });
    try {
      const token = await server.token();
      const original = (await (
        await server.request("/api/publish", {
          token,
          body: { requestId: "initial", source: page("<p>Original</p>") },
        })
      ).json()) as { id: string; source: string };
      const ids = (await (
        await server.request("/api/ids", {
          token,
          body: { count: 1 },
          headers: { "Idempotency-Key": "backend" },
        })
      ).json()) as { ids: string[] };
      const backendId = ids.ids[0]!;
      const source = page(
        "<p>Blocked compilation</p>",
        `<link rel="af-backend" href="/af/v1/ids/${backendId}" data-af-name="api">`,
      );
      const backend =
        "export const typeDefs=`type Query { ok:Boolean! }`; export default {Query:{ok:()=>true}};";
      pending = server.request(`/api/files/${original.id}/source`, {
        method: "PUT",
        token,
        headers: { "If-Match": "1", "Idempotency-Key": "delayed" },
        body: { source, files: { [backendId]: backend } },
      });
      await Promise.race([
        entered.promise,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(Error("compiler did not start")),
            5000,
          );
          timer.unref();
        }),
      ]);
      // A compiler suspended within a transaction would retain the header read's table lock.
      const client = await server.connect();
      try {
        await client.query("BEGIN");
        await client.query("LOCK TABLE files IN ACCESS EXCLUSIVE MODE NOWAIT");
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      if (race === "revoked session")
        await server.query("DELETE FROM sessions WHERE token_hash=$1", [
          createHash("sha256").update(token).digest("hex"),
        ]);
      else {
        const competing = await server.request(
          `/api/files/${original.id}/source`,
          {
            method: "PUT",
            token,
            headers: { "If-Match": "1" },
            body: { source: page("<p>Winning save</p>") },
          },
        );
        assert.equal(competing.status, 200);
      }
      resume.release();
      const result = await pending;
      assert.equal(result.status, race === "revoked session" ? 403 : 409);
      if (race === "advanced head") {
        const body = (await result.json()) as {
          version: number;
          source: string;
        };
        assert.equal(body.version, 2);
        assert.match(body.source, /Winning save/);
      }
      assert.equal(
        (
          await server.query(
            "SELECT count(*)::int AS count FROM idempotency_keys WHERE key='delayed'",
          )
        ).rows[0]!.count,
        0,
      );
      assert.equal(
        (
          await server.query(
            "SELECT count(*)::int AS count FROM af_backend_versions WHERE file_id=$1",
            [backendId],
          )
        ).rows[0]!.count,
        0,
      );
    } finally {
      resume.release();
      await pending?.catch(() => {});
      await server.close();
    }
  });
}
