import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  normalizeLegacyManagedFrames,
  hasLegacyManagedFrame,
} from "../src/migration/conversion/compiled/legacy-scripts.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const source = '<Iframe id="kept"><p id="child">Original</p></Iframe>';
test("normalization records both exact byte digests without changing the retained source", async () => {
  const retained = { source, document: { source } };
  const before = JSON.stringify(retained);
  const derived = '<div id="kept"><p id="child">Original</p></div>';
  const result = await normalizeLegacyManagedFrames(retained.source, {
    migrate: async (received) => {
      assert.equal(received, source);
      return {
        source: derived,
        changed: true,
        applied: ["managed Iframe"],
        unresolved: [],
      };
    },
  });
  assert.equal(result?.source, derived);
  assert.equal(result?.receipt.appliedRuleCount, 1);
  assert.equal("applied" in result!.receipt, false);
  assert.equal(result?.receipt.originalSourceSha256, hash(source));
  assert.equal(result?.receipt.derivedSourceSha256, hash(derived));
  assert.equal(JSON.stringify(retained), before);
});
test("unresolved, unchanged and still managed sources are not promoted", async () => {
  for (const result of [
    { source, changed: false, applied: [], unresolved: [] },
    {
      source: "<div/>",
      changed: true,
      applied: ["partial"],
      unresolved: ["unsupported script"],
    },
    { source, changed: true, applied: ["partial"], unresolved: [] },
  ]) {
    assert.equal(
      await normalizeLegacyManagedFrames(source, {
        migrate: async () => result,
      }),
      null,
    );
  }
});
test("ordinary source does not invoke a retired script adapter", async () => {
  assert.equal(
    await normalizeLegacyManagedFrames('<p id="unchanged">Page</p>', {
      migrate: async () => {
        throw Error("must not run");
      },
    }),
    null,
  );
});

test("frame detection follows JSX syntax without treating script strings or native iframe as managed frames", () => {
  assert.equal(
    hasLegacyManagedFrame(
      '<Helmet><script>{`const example="<Iframe/>";`}</script></Helmet>',
    ),
    false,
  );
  assert.equal(
    hasLegacyManagedFrame('<iframe src="https://example.invalid/"/>'),
    false,
  );
  assert.equal(
    hasLegacyManagedFrame("<div>{true ? <Iframe/> : null}</div>"),
    true,
  );
});
