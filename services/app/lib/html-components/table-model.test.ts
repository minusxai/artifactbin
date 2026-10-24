import { describe, expect, it } from "vitest";
import {
  nextTableSort,
  tableRowIdentities,
  TableLoader,
  type TableData,
} from "./table-model";
describe("table model", () => {
  it("cycles sort and distinguishes typed stable keys", () => {
    expect(nextTableSort(null, "a")).toEqual({ col: "a", dir: "asc" });
    expect(nextTableSort({ col: "a", dir: "asc" }, "a")).toEqual({
      col: "a",
      dir: "desc",
    });
    expect(nextTableSort({ col: "a", dir: "desc" }, "a")).toBeNull();
    expect(tableRowIdentities([{ id: 1 }, { id: "1" }], "id")[0]).not.toBe(
      tableRowIdentities([{ id: "1" }], "id")[0],
    );
    expect(() => tableRowIdentities([{ id: 1 }, { id: 1 }], "id")).toThrow(
      "unique",
    );
  });
  it("aborts replaced requests and drops stale success and failure", async () => {
    const loader = new TableLoader();
    let resolve!: (value: TableData) => void;
    let signal!: AbortSignal;
    const old = loader.read(
      {
        read: (r) => {
          signal = r.signal;
          return new Promise((r) => (resolve = r));
        },
      },
      { offset: 0, limit: 10, sort: null },
    );
    const latest = { rows: [], columns: [] };
    expect(
      await loader.read(
        { read: async () => latest },
        { offset: 0, limit: 10, sort: null },
      ),
    ).toBe(latest);
    expect(signal.aborted).toBe(true);
    resolve(latest);
    expect(await old).toBeUndefined();
  });
});

import { tableWindow } from "./table-model";
it("bounds large windows and clamps after shrink without dropping the last row", () => {
  expect(tableWindow(100000, 0, 420)).toEqual({
    start: 0,
    end: 36,
    before: 0,
    after: 99964 * 36,
  });
  expect(tableWindow(1, 90000, 420)).toEqual({
    start: 0,
    end: 1,
    before: 0,
    after: 0,
  });
});
it("drops stale rejected requests but surfaces the current adapter failure", async () => {
  const loader = new TableLoader();
  let reject!: (error: Error) => void;
  const stale = loader.read(
    { read: () => new Promise((_resolve, r) => (reject = r)) },
    { offset: 0, limit: 5, sort: null },
  );
  loader.cancel();
  reject(new Error("obsolete"));
  expect(await stale).toBeUndefined();
  await expect(
    loader.read(
      {
        read: async () => {
          throw new Error("current");
        },
      },
      { offset: 0, limit: 5, sort: null },
    ),
  ).rejects.toThrow("current");
});
