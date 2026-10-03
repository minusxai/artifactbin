// Validation of occurrence/outbox admission, not a product scheduler.
import { CronExpressionParser } from "cron-parser";
import { createHash } from "node:crypto";
export const nextDue = (cron, timezone, now) => {
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now);
  return CronExpressionParser.parse(cron, { tz: timezone, currentDate: now })
    .next()
    .toDate();
};
export async function scheduleSchema(db) {
  for (const sql of [
    "CREATE TABLE IF NOT EXISTS design_schedules(id text PRIMARY KEY,cron text NOT NULL,timezone text NOT NULL,next_due_at timestamptz NOT NULL,active_request text)",
    "CREATE TABLE IF NOT EXISTS design_occurrences(schedule_id text NOT NULL,scheduled_at timestamptz NOT NULL,request_id text NOT NULL UNIQUE,PRIMARY KEY(schedule_id,scheduled_at))",
    "CREATE TABLE IF NOT EXISTS design_outbox(request_id text PRIMARY KEY,status text NOT NULL DEFAULT 'pending')",
  ])
    await db.query(sql);
}
export async function claimDue(db, now) {
  return db.transaction(async (tx) => {
    const due = (
        await tx.query(
          "SELECT * FROM design_schedules WHERE next_due_at<=$1 AND active_request IS NULL ORDER BY next_due_at FOR UPDATE SKIP LOCKED",
          [now],
        )
      ).rows,
      claimed = [];
    for (const row of due) {
      const instant = new Date(row.next_due_at).toISOString(),
        requestId = createHash("sha256")
          .update(row.id + ":" + instant)
          .digest("hex");
      const inserted = await tx.query(
        "INSERT INTO design_occurrences VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_id",
        [row.id, instant, requestId],
      );
      if (inserted.rows.length) {
        await tx.query("INSERT INTO design_outbox(request_id) VALUES($1)", [
          requestId,
        ]);
        claimed.push({ requestId, scheduleId: row.id, scheduledAt: instant });
      }
      // Coalesce missed ticks into this occurrence; next tick follows current time. Busy schedules cannot overlap.
      await tx.query(
        "UPDATE design_schedules SET next_due_at=$2,active_request=$3 WHERE id=$1",
        [row.id, nextDue(row.cron, row.timezone, now), requestId],
      );
    }
    return claimed;
  });
}
