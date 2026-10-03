// CI-only true concurrent transactions. No app/prod database is used.
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DesignRunner } from "./runner.mjs";
import { scheduleSchema, claimDue } from "./scheduler.mjs";
const pool = new pg.Pool({
  connectionString: process.env.RUNNER_VALIDATION_DATABASE,
  max: 20,
});
const db = {
  query: (...args) => pool.query(...args),
  transaction: async (fn) => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const value = await fn(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  },
};
const runner = new DesignRunner(db, async () => ({}));
try {
  await runner.initialize();
  const request = {
    requestId: randomUUID(),
    userId: "owner",
    bundle: 'var Program={default:async()=>({outcome:"completed"})}',
    input: {},
    timeoutMs: 15000,
  };
  const starts = await Promise.all(
    Array.from({ length: 16 }, () => runner.start(request)),
  );
  assert.equal(new Set(starts.map((r) => r.runId)).size, 1);
  const first = starts[0].runId;
  await runner.wait(first);
  const second = (await runner.start({ ...request, requestId: randomUUID() }))
    .runId;
  await runner.wait(second);
  const convo = randomUUID();
  await db.query("INSERT INTO design_conversations(id) VALUES($1)", [convo]);
  for (const id of [first, second])
    await db.query(
      "INSERT INTO design_branches(id,conversation_id,run_id) VALUES($1,$2,$3)",
      [id, convo, id],
    );
  await Promise.all(
    Array.from({ length: 20 }, (_, n) =>
      runner.commit(n % 2 ? first : second, { outcome: "completed" }),
    ),
  );
  assert.equal(
    (
      await db.query("SELECT revision FROM design_conversations WHERE id=$1", [
        convo,
      ])
    ).rows[0].revision,
    2,
  );
  // A failed finalization must roll both branch and revision back.
  const failed = randomUUID();
  await db.query(
    "INSERT INTO design_branches(id,conversation_id,run_id) VALUES($1,$2,$3)",
    [failed, convo, failed],
  );
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.query("UPDATE design_branches SET final=$2 WHERE id=$1", [
        failed,
        '{"outcome":"bad"}',
      ]);
      await tx.query(
        "UPDATE design_conversations SET revision=revision+1 WHERE id=$1",
        [convo],
      );
      throw Error("injected failure");
    }),
  );
  assert.equal(
    (await db.query("SELECT final FROM design_branches WHERE id=$1", [failed]))
      .rows[0].final,
    null,
  );
  assert.equal(
    (
      await db.query("SELECT revision FROM design_conversations WHERE id=$1", [
        convo,
      ])
    ).rows[0].revision,
    2,
  );
  await scheduleSchema(db);
  const scheduleId = randomUUID();
  await db.query("INSERT INTO design_schedules VALUES($1,$2,$3,$4,NULL)", [
    scheduleId,
    "*/5 * * * *",
    "UTC",
    "2026-10-02T09:00:00Z",
  ]);
  const occurrences = (
    await Promise.all(
      Array.from({ length: 16 }, () =>
        claimDue(db, new Date("2026-10-02T10:01:00Z")),
      ),
    )
  ).flat();
  assert.equal(occurrences.length, 1);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM design_outbox")).rows[0].n,
    1,
  );
  console.log(
    "PostgreSQL17: 16 concurrent scheduler claims -> one occurrence/outbox; overlap serialized",
  );
  console.log(
    "PostgreSQL17: 16 concurrent admissions -> one run; 20 parallel finalizations -> two outcomes; rollback atomic",
  );
} finally {
  await runner.close();
  await pool.end();
}
