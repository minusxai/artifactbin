import {SCHEDULE_TABLES,ensureRunnerTables} from './schema';
import { CronExpressionParser } from 'cron-parser';
import { createHash, randomUUID } from 'node:crypto';
import type { RunStart, RunnerService, RunnerJson } from '@artifactbin/contracts';
import type { TransactionalDatabase } from './coordinator';
export interface ScheduleInput {
    userId: string;
    artifactId: string;
    version: string;
    cron: string;
    timezone: string;
    program: RunStart['program'];
    input: RunnerJson;
}
interface ScheduleRow {
    id: string;
    owner: string;
    spec: ScheduleInput;
    next_due_at: Date;
    active_request: string | null;
    enabled: boolean;
}
const nextDue = (cron: string, timezone: string, now: Date) => { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now); return CronExpressionParser.parse(cron, { tz: timezone, currentDate: now }).next().toDate(); };
/** A durable occurrence is the submission retry key; failed executions are never automatically replayed. */
export async function createScheduler(db: TransactionalDatabase, runner: RunnerService, canRun: (spec: ScheduleInput) => Promise<boolean> = async () => true) {
    await ensureRunnerTables(db,SCHEDULE_TABLES);
    let ticking = false;
    return {
        async put(spec: ScheduleInput, now = new Date()) { if (!spec.userId || !spec.artifactId || !spec.version)
            throw Error('invalid_schedule'); const due = nextDue(spec.cron, spec.timezone, now); const id = randomUUID(); await db.query('INSERT INTO runner_schedules(id,owner,spec,next_due_at) VALUES($1,$2,$3,$4)', [id, spec.userId, JSON.stringify(spec), due]); return { id, nextDueAt: due.toISOString() }; },
        async list(userId: string) { return (await db.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE owner=$1 AND enabled=true ORDER BY next_due_at LIMIT 100', [userId])).rows; },
        async remove(userId: string, id: string) { const rows = await db.query('UPDATE runner_schedules SET enabled=false WHERE id=$1 AND owner=$2 RETURNING id', [id, userId]); if (!rows.rows.length)
            throw Error('not_found'); },
        async tick(now = new Date()) {
            if (ticking)
                return;
            ticking = true;
            try {
                await db.transaction(async (tx) => {
                    const rows = (await tx.query<ScheduleRow>('SELECT * FROM runner_schedules WHERE enabled=true AND next_due_at<=$1 AND active_request IS NULL ORDER BY next_due_at LIMIT 100 FOR UPDATE SKIP LOCKED', [now])).rows;
                    for (const row of rows) {
                        const instant = new Date(row.next_due_at).toISOString();
                        const requestId = createHash('sha256').update(row.id + ':' + instant).digest('hex');
                        await tx.query('INSERT INTO runner_schedule_occurrences(request_id,schedule_id,scheduled_at,spec) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [requestId, row.id, instant, JSON.stringify(row.spec)]);
                        await tx.query('UPDATE runner_schedules SET active_request=$2,next_due_at=$3 WHERE id=$1', [row.id, requestId, nextDue(row.spec.cron, row.spec.timezone, now)]);
                    }
                });
                const pending = (await db.query<{
                    request_id: string;
                    schedule_id: string;
                    spec: ScheduleInput;
                    run_id: string | null;
                }>("SELECT * FROM runner_schedule_occurrences WHERE status IN ('pending','running') ORDER BY scheduled_at LIMIT 100")).rows;
                for (const item of pending) {
                    if (!item.run_id) {
                        const s = item.spec;
                        if (!await canRun(s)) {
                            await db.transaction(async (tx) => { await tx.query("UPDATE runner_schedule_occurrences SET status='cancelled' WHERE request_id=$1", [item.request_id]); await tx.query('UPDATE runner_schedules SET enabled=false,active_request=NULL WHERE id=$1', [item.schedule_id]); });
                            continue;
                        }
                        const { runId } = await runner.start({ requestId: `cron:${item.request_id}`, userId: s.userId, artifactId: s.artifactId, artifactVersion: s.version, program: s.program, input: s.input });
                        item.run_id = runId;
                        await db.query("UPDATE runner_schedule_occurrences SET run_id=$2,status='running' WHERE request_id=$1", [item.request_id, runId]);
                    }
                    const status = await runner.getRun({ userId: item.spec.userId, runId: item.run_id });
                    if (!status.receipt)
                        continue;
                    await db.transaction(async (tx) => { await tx.query('UPDATE runner_schedule_occurrences SET status=$2 WHERE request_id=$1', [item.request_id, status.status]); await tx.query('UPDATE runner_schedules SET active_request=NULL WHERE id=$1 AND active_request=$2', [item.schedule_id, item.request_id]); });
                }
            }
            finally {
                ticking = false;
            }
        }
    };
}
