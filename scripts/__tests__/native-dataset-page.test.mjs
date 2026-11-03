import { expect, it } from "vitest";
import { readDataset } from "../gates/lib/native-dataset-page.mjs";
const rows = (from, count) => Array.from({ length: count }, (_, i) => ({ _id: `r${from + i}`, choice: "ramen" }));
it("names the link's generated columns and reads every page of 100 until a short one", async () => {
  const calls = [];
  const replies = [{ data: rows(0, 100) }, { data: rows(100, 100) }, { data: rows(200, 5) }];
  const result = await readDataset(async (text, variables) => {
    calls.push({ text, variables });
    return replies.shift();
  }, ["choice"]);
  expect(result.rows).toHaveLength(205);
  expect(result.rows.at(-1)._id).toBe("r204");
  expect(calls.map((c) => c.variables)).toEqual([{ offset: 0 }, { offset: 100 }, { offset: 200 }]);
  expect(calls[0].text).toBe("query($offset:Int!){data(limit:100,offset:$offset){_id choice}}");
});
it("stops after one short page", async () => {
  const calls = [];
  const result = await readDataset(async (_text, variables) => {
    calls.push(variables);
    return { data: rows(0, 3) };
  }, ["choice"]);
  expect(result.rows).toHaveLength(3);
  expect(calls).toEqual([{ offset: 0 }]);
});
it("refuses a page that repeats instead of advancing rather than hanging the gate", async () => {
  await expect(readDataset(async () => ({ data: rows(0, 100) }), ["choice"])).rejects.toThrow("offset did not advance");
});
