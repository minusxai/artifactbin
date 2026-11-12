import { expect, it } from "vitest";
import { readDataset } from "../gates/lib/native-dataset-page.mjs";
const rows = (from, count) => Array.from({ length: count }, (_, i) => ({ _id: `r${from + i}`, choice: "ramen" }));
it("names the link's SQL columns and reads every page of 100 until a short one", async () => {
  const calls = [];
  const replies = [rows(0, 100), rows(100, 100), rows(200, 5)];
  const result = await readDataset(async (columns, offset) => {
    calls.push({ columns, offset });
    return replies.shift();
  }, ["choice"]);
  expect(result.rows).toHaveLength(205);
  expect(result.rows.at(-1)._id).toBe("r204");
  expect(calls.map((c) => c.offset)).toEqual([0,100,200]);
  expect(calls.every(call=>JSON.stringify(call.columns)===JSON.stringify(["choice"]))).toBe(true);
});
it("stops after one short page", async () => {
  const calls = [];
  const result = await readDataset(async (_columns, offset) => {
    calls.push(offset);
    return rows(0, 3);
  }, ["choice"]);
  expect(result.rows).toHaveLength(3);
  expect(calls).toEqual([0]);
});
it("refuses a page that repeats instead of advancing rather than hanging the gate", async () => {
  await expect(readDataset(async () => (rows(0, 100)), ["choice"])).rejects.toThrow("offset did not advance");
});
