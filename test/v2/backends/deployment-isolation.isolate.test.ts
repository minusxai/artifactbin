/** Two real controllers share one Docker engine without sharing cleanup ownership. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackendHost } from "../../../src/backend/container-host.ts";
import { dockerCommand, reapBackendContainers } from "../../../src/backend/reaper.ts";

test("cleaning one deployment leaves another deployment's warm sandbox serving", async (t) => {
  const first = createBackendHost({ deploymentNamespace: "afv2a", sandboxNetwork: "none" });
  const second = createBackendHost({ deploymentNamespace: "afv2b", sandboxNetwork: "none" });
  t.after(async () => { await first.close?.(); await second.close?.(); });
  const deployment = await first.compile(`
export const typeDefs = 'type Query { count: Int! }';
let count = 0;
export default { Query: { count: () => ++count } };`);
  const request = {
    deployment, principal: { tenant: "test-page", subject: null },
    input: { field: "count", args: null }, env: {},
    reuse: { kind: "file" as const, scope: { owner: "test-owner", fileId: "test-backend" } },
  };
  assert.equal(await first.invoke(request), 1);
  assert.equal(await second.invoke(request), 1);
  assert.equal(await reapBackendContainers(dockerCommand, { deploymentNamespace: "afv2a" }), 1);
  assert.equal(await second.invoke(request), 2, "other deployment retains its original warm sandbox");
  assert.equal(await reapBackendContainers(dockerCommand, { deploymentNamespace: "afv2a" }), 0);
});
