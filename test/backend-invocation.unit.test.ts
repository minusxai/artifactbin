import test from "node:test";
import assert from "node:assert/strict";
import { checkedBackendReuse } from "../src/backend/contracts.ts";
test("invocation disposition is explicit and copies trusted file identity", () => {
  for (const invalid of [
    undefined,
    null,
    {},
    { kind: "file" },
    { kind: "file", scope: undefined },
    { kind: "one-shot", scope: { owner: "o", fileId: "f" } },
  ])
    assert.throws(() => checkedBackendReuse(invalid), /deployment_invalid/);
  assert.deepEqual(checkedBackendReuse({ kind: "one-shot" }), {
    kind: "one-shot",
  });
  const scope = { owner: "owner", fileId: "file" };
  const result = checkedBackendReuse({ kind: "file", scope });
  scope.fileId = "changed";
  assert.deepEqual(result, {
    kind: "file",
    scope: { owner: "owner", fileId: "file" },
  });
});
