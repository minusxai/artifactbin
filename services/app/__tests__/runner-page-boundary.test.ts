import { it, expect } from "vitest";
import { useAppHarness } from "./harness";
import { createSqliteSql } from "@artifactbin/sql/sqlite";
import { DesignRunner } from "../../../docs/proposals/runner-validation/runner.mjs";
import {
  bundlePageFixture,
  probeNativeColdReady,
} from "../../../docs/proposals/runner-validation/page-fixture.mjs";
const harness = useAppHarness();

it("reproduces native cold-ready gap and proves initial state synchronization fixes the binding", async () => {
  expect(await probeNativeColdReady()).toEqual({
    before: { loading: false, rows: [] },
    afterLoading: true,
    waited: true,
    rows: [{ total: 42 }],
  });
});

it("runs a page-module fixture without DOM, reads real SQL, commits a mutation and refreshes signals", async () => {
  const sql = createSqliteSql({ maxRows: 100, timeoutMs: 2000 });
  let rows = [
    { region: "west", amount: 10 },
    { region: "east", amount: 20 },
  ];
  const columns = [
    { name: "region", type: "string" as const },
    { name: "amount", type: "number" as const },
  ];
  const calls: string[] = [];
  const runner = new DesignRunner(
    await harness.db(),
    async (_id: string, run: any, operation: string, args: any) => {
      expect(run.request.userId).toBe("fixture-user");
      if (operation === "read") {
        expect(args.name).toBe("monthly");
        calls.push("read:" + args.params.region);
        const result = (
          await sql.run({
            tables: { sales: { rows, columns } },
            queries: [
              {
                name: "monthly",
                sql: "SELECT SUM(amount) AS total FROM sales WHERE region=$region",
              },
            ],
            params: args.params,
          })
        ).monthly!;
        if ("error" in result) throw Error(result.error);
        return result;
      }
      expect(operation).toBe("reply");
      expect(args.name).toBe("rename");
      const result = await sql.mutate({
        table: { name: "sales", rows, columns },
        sql: "UPDATE sales SET region=$to WHERE region=$from",
        params: args.args,
      });
      if ("error" in result) throw Error(result.error);
      rows = result.rows as typeof rows;
      calls.push("commit");
      return { committed: true };
    },
  );
  await runner.initialize();
  try {
    const bundle =
      await bundlePageFixture(`import { region, monthly, rename } from 'page';
export default async function() {
  const initial = await monthly.ready;
  region.value = 'east';
  const loading = monthly.loading.value;
  const east = await monthly.ready;
  await rename({from:'west',to:'east'});
  const updated = await monthly.ready;
  return { initial, loading, east, updated, dom: typeof document };
}`);
    const { runId } = await runner.start({
      userId: "fixture-user",
      requestId: crypto.randomUUID(),
      bundle,
      input: {},
      timeoutMs: 10000,
    });
    const result = await runner.wait(runId);
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.result).toEqual({
      initial: [{ total: 10 }],
      loading: true,
      east: [{ total: 20 }],
      updated: [{ total: 30 }],
      dom: "undefined",
    });
    expect(calls).toEqual(["read:west", "read:east", "commit", "read:east"]);
  } finally {
    await runner.close();
  }
}, 15000);

it("rejects an undeclared page import before a run starts", async () => {
  await expect(
    bundlePageFixture(
      "import { absent } from 'page'; export default () => absent.value",
    ),
  ).rejects.toThrow("absent");
});

it("propagates host query and mutation failures through ready and mutation promises", async () => {
  const runner = new DesignRunner(await harness.db(), async () => {
    throw Error("denied_fixture");
  });
  await runner.initialize();
  try {
    const bundle =
      await bundlePageFixture(`import { monthly, rename } from 'page';
export default async function() {
  let readError, writeError;
  try { await monthly.ready; } catch(e) { readError = e.message; }
  try { await rename({}); } catch(e) { writeError = e.message; }
  return {readError, writeError, signalError: monthly.error.value};
}`);
    const { runId } = await runner.start({
      userId: "denied",
      requestId: crypto.randomUUID(),
      bundle,
      input: {},
      timeoutMs: 10000,
    });
    const result = await runner.wait(runId);
    expect(result.status).toBe("completed");
    expect(result.result).toEqual({
      readError: "denied_fixture",
      writeError: "denied_fixture",
      signalError: "denied_fixture",
    });
  } finally {
    await runner.close();
  }
}, 15000);

it("keeps the latest refresh and isolates page state across simultaneous runs", async () => {
  const runner = new DesignRunner(
    await harness.db(),
    async (_id: string, run: any, _operation: string, args: any) => {
      if (args.params.region === "west")
        await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        rows: [{ region: args.params.region, user: run.request.userId }],
      };
    },
  );
  await runner.initialize();
  try {
    const bundle =
      await bundlePageFixture(`import { region, monthly } from 'page';
export default async function(input) {
  region.value = input.region;
  return { pending: monthly.loading.value, rows: await monthly.ready };
}`);
    const starts = await Promise.all(
      ["east", "north"].map((region) =>
        runner.start({
          userId: region,
          requestId: crypto.randomUUID(),
          bundle,
          input: { region },
          timeoutMs: 10000,
        }),
      ),
    );
    const results = await Promise.all(
      starts.map(({ runId }: any) => runner.wait(runId)),
    );
    for (const [i, region] of ["east", "north"].entries()) {
      expect(results[i].status, JSON.stringify(results[i])).toBe("completed");
      expect(results[i].result).toEqual({
        pending: true,
        rows: [{ region, user: region }],
      });
    }
  } finally {
    await runner.close();
  }
}, 15000);
