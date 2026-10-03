import {RUN_TABLES,ensureRunnerTables} from './schema';
import type { RunStart, RunReceipt, RunnerJson, RunStatus } from '@artifactbin/contracts';
export interface RunnerDatabase {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{
        rows: T[];
    }>;
}
export interface RunRow {
    id: string;
    owner: string;
    fingerprint: string;
    status: RunStatus;
    request: RunStart;
    admitted_at: string;
    started_at: string | null;
    receipt: RunReceipt | null;
    output: RunnerJson;
}
/** Runner-owned persistence, independent of the app schema. One controller per database. */
export async function initializeStore(db:RunnerDatabase){await ensureRunnerTables(db,RUN_TABLES);}
export async function ownedRun(db: RunnerDatabase, userId: string, runId: string) {
    const row = (await db.query<RunRow>('SELECT * FROM runner_runs WHERE id=$1 AND owner=$2', [runId, userId])).rows[0];
    if (!row)
        throw Error('not_found');
    return row;
}
