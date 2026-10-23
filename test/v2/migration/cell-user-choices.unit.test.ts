import test from "node:test";
import assert from "node:assert/strict";
import { createCompiledCellUserChoices } from "../../../src/migration/conversion/compiled/cell-user-choice-runtime.ts";
test("registered cell choices clear on loading, revocation, malformed responses and disposal", () => {
  let next!: (v: unknown) => void,
    error!: () => void,
    stops = 0;
  const snapshots: any[] = [];
  const adapter = createCompiledCellUserChoices(
    [{ queryName: "items", column: "owner", backendNamespace: "legacyData" }],
    {
      watch: (_binding, n, e) => {
        next = n;
        error = e;
        return () => stops++;
      },
      changed: (s) => snapshots.push(structuredClone(s)),
    },
  );
  next(JSON.stringify([{ value: "User12", label: "Person one" }]));
  assert.deepEqual(snapshots.at(-1), {
    "items.owner": [{ value: "User12", label: "Person one" }],
  });
  next(undefined);
  assert.deepEqual(snapshots.at(-1), { "items.owner": [] });
  next(JSON.stringify([{ value: "User12", label: "Person one" }]));
  error();
  assert.deepEqual(snapshots.at(-1), { "items.owner": [] });
  next("not json");
  assert.deepEqual(snapshots.at(-1), { "items.owner": [] });
  next(
    JSON.stringify([
      { value: "User12", label: "Person one", email: "private.invalid" },
    ]),
  );
  assert.deepEqual(snapshots.at(-1), { "items.owner": [] });
  adapter.dispose();
  assert.equal(stops, 1);
  const n = snapshots.length;
  next(JSON.stringify([{ value: "User12", label: "Person one" }]));
  assert.equal(snapshots.length, n);
});
