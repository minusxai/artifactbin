import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureConnection } from "../src/auth";
import { ApiError } from "../src/client";
import { parseArgs } from "../src/config";

const saved = { server: "https://example.com", token: "old" };
for (const status of [undefined, 401, 403, 503]) {
  test(`startup authentication handles ${status ?? "valid credentials"}`, async () => {
    let prompted = 0;
    const flow = {
      validate: async () => { if (status) throw new ApiError("error", status); },
      authenticate: async (server: string) => { prompted++; return { server, token: "new" }; },
      notify: () => {},
    };
    if (status && status !== 401) {
      await assert.rejects(ensureConnection(saved, undefined, flow), ApiError);
      assert.equal(prompted, 0);
    } else {
      const result = await ensureConnection(saved, undefined, flow);
      assert.equal(result.token, status === 401 ? "new" : "old");
      assert.equal(prompted, status === 401 ? 1 : 0);
    }
  });
}
test("bare commands reach auth and missing credentials use the selected server", async () => {
  for (const args of [[], ["remote"]]) {
    assert.equal(parseArgs(args).command, "remote");
    assert.equal(parseArgs(args).harness, undefined);
  }
  const result = await ensureConnection(null, "http://localhost:6400", {
    validate: async () => assert.fail("no token to validate"),
    authenticate: async server => ({ server, token: "new" }),
    notify: () => {},
  });
  assert.equal(result.server, "http://localhost:6400");
});
