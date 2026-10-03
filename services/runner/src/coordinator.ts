import {AGENT_TABLES,ensureRunnerTables} from './schema';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { RunnerService, RunnerJson, RunStart } from '@artifactbin/contracts';
import type { RunnerDatabase } from './store';
export interface TransactionalDatabase extends RunnerDatabase {
    transaction<T>(fn: (tx: RunnerDatabase) => Promise<T>): Promise<T>;
}
interface Branch {
    id: string;
    owner: string;
    artifact_id: string;
    request_key: string;
    input: RunnerJson;
    run_id: string | null;
    cancel_pending: boolean;
    program_source:string|null;
    cursor: number;
    checkpoint: RunnerJson;
    result: RunnerJson;
    status: string;
}
export interface AgentOperationTool {
    name: string;
    description: string;
    parameters: RunnerJson;
}
export interface AgentDispatch {
    userId: string;
    artifactId: string;
    requestId: string;
    message: string;
    model: string;
    instructions?: string;
    context?: RunnerJson;
    operationTools?: AgentOperationTool[];
}
function stable(value:unknown):string {if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
function sameDispatch(branch:Branch,input:AgentDispatch){const original=branch.input as Record<string,RunnerJson>;for(const key of ['userId','artifactId','requestId','message','model','instructions','context','operationTools'] as const)if(stable(original[key])!==stable(input[key]))throw Error('agent_request_conflict');}
/** Hosted deployment component. Not started by the OSS composition. History never belongs to the runner. */
export async function createAgentCoordinator(db: TransactionalDatabase, runner: RunnerService, programSource?: string) {
    const source = programSource ?? await readFile(new URL('./agent.ts.txt', import.meta.url), 'utf8');
    await ensureRunnerTables(db,AGENT_TABLES);
    let ticking = false;
    // An existing transaction lets terminal buffering and branch admission commit atomically.
    async function dispatch(input: AgentDispatch, transaction?: RunnerDatabase) {
        if (!input.userId || !input.requestId || !input.artifactId || input.message.length > 32000)
            throw Error('invalid_agent_request');
        const enqueue = async (tx: RunnerDatabase) => {
            const prior = (await tx.query<Branch>('SELECT * FROM hosted_branches WHERE owner=$1 AND request_key=$2', [input.userId, input.requestId])).rows[0];
            if(prior){sameDispatch(prior,input);return {branchId:prior.id};}
            await tx.query('INSERT INTO hosted_conversations(owner,artifact_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [input.userId, input.artifactId]);
            await tx.query('SELECT * FROM hosted_conversations WHERE owner=$1 AND artifact_id=$2 FOR UPDATE', [input.userId, input.artifactId]);
            const recent = (await tx.query<Branch>('SELECT * FROM hosted_branches WHERE owner=$1 AND artifact_id=$2 ORDER BY created_at DESC,id DESC LIMIT 8', [input.userId, input.artifactId])).rows;
            // Preserve each transcript. Seed from one complete branch; summarize other outcomes rather than interleaving tool chains.
            const base = (await tx.query<Branch>("SELECT * FROM hosted_branches WHERE owner=$1 AND artifact_id=$2 AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 1", [input.userId, input.artifactId])).rows[0];
            const result = base?.result as {
                messages?: RunnerJson[];
            } | undefined;
            let history = result?.messages ?? [];
            while (Buffer.byteLength(JSON.stringify(history)) > 128 * 1024) {
                const next = history.findIndex((m, index) => index > 0 && !!m && typeof m === 'object' && !Array.isArray(m) && m.role === 'user');
                history = next < 0 ? [] : history.slice(next);
            }
            const others = recent.filter(b => b.id !== base?.id).map(b => ({ branchId: b.id, status: b.status, message: String((b.input as Record<string, RunnerJson>).message ?? '').slice(0,2000), outcome: JSON.stringify(b.result ?? b.checkpoint ?? null).slice(-2000) }));
            const payload = { ...input, history, otherBranches: others };
            if (Buffer.byteLength(JSON.stringify(payload)) > 200 * 1024)
                throw Error('conversation_context_limit');
            const id = randomUUID();
            await tx.query('INSERT INTO hosted_branches(id,owner,artifact_id,request_key,input,program_source,created_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()) ON CONFLICT(owner,request_key) DO NOTHING', [id, input.userId, input.artifactId, input.requestId, JSON.stringify(payload), source]);
            const saved = (await tx.query<Branch>('SELECT * FROM hosted_branches WHERE owner=$1 AND request_key=$2', [input.userId, input.requestId])).rows[0]!;
            sameDispatch(saved,input);
            return { branchId: saved.id };
        };
        return transaction ? enqueue(transaction) : db.transaction(enqueue);
    }
    async function tick() {
        if (ticking)
            return;
        ticking = true;
        try {
            const revoked = (await db.query<Branch>("SELECT * FROM hosted_branches WHERE status='cancelled' AND cancel_pending=true AND run_id IS NOT NULL ORDER BY created_at LIMIT 100")).rows;
            for (const branch of revoked) {
                try { await revoke(branch); } catch { /* Durable intent remains for the next tick. */ }
            }
            const pending = (await db.query<Branch>("SELECT * FROM hosted_branches WHERE status IN ('pending','running') ORDER BY created_at LIMIT 100")).rows;
            for (const branch of pending) {
                try { await advance(branch); }
                catch (error) {
                    const reason = error instanceof Error ? error.message : 'runner_failed';
                    // Transport/admission pressure is retried; malformed pinned programs and lost runs are terminal.
                    const permanent = /invalid_|import_not_allowed|source_limit|size_limit|start_conflict|Build failed/.test(reason);
                    if (!permanent && reason !== 'not_found') continue;
                    await db.query("UPDATE hosted_branches SET status=$2,result=$3 WHERE id=$1 AND status IN ('pending','running')", [branch.id, reason === 'not_found' ? 'interrupted' : 'failed', JSON.stringify({receipt:{reason:reason.slice(0,2000)}})]);
                }
            }
        }
        finally {
            ticking = false;
        }
    }
    async function advance(branch: Branch) {
        const live = (await db.query<Branch>('SELECT * FROM hosted_branches WHERE id=$1', [branch.id])).rows[0];
        if (!live || !['pending', 'running'].includes(live.status))
            return;
        if (!branch.run_id) {
            const input = branch.input as Record<string, RunnerJson>;
            const start: RunStart = { userId: branch.owner, artifactId: branch.artifact_id, requestId: `agent:${branch.id}`, program: { language: 'typescript', source:branch.program_source??source }, input, limits: { timeoutMs: 120000 } };
            const { runId } = await runner.start(start);
            await db.query("UPDATE hosted_branches SET run_id=$2,status='running' WHERE id=$1 AND run_id IS NULL AND status='pending'", [branch.id, runId]);
            const latest=(await db.query<Branch>('SELECT * FROM hosted_branches WHERE id=$1',[branch.id])).rows[0];
            if(latest?.status==='cancelled'){
                await db.query("UPDATE hosted_branches SET run_id=$2,cancel_pending=true WHERE id=$1 AND status='cancelled'", [branch.id,runId]);
                await revoke({...latest,run_id:runId});
                return;
            }
            branch.run_id = runId;
        }
        const lookup = { userId: branch.owner, runId: branch.run_id };
        let cursor = branch.cursor;
        for (;;) {
            const page = await runner.events({ ...lookup, afterSequence: cursor, limit: 100 });
            for (const item of page.events) {
                const event = item.event as {
                    type?: string;
                    messages?: RunnerJson;
                };
                if (event?.type === 'checkpoint' && Array.isArray(event.messages)) {
                    await db.query('UPDATE hosted_branches SET checkpoint=$2,cursor=$3 WHERE id=$1 AND cursor<$3', [branch.id, JSON.stringify(event.messages), item.sequence]);
                }
            }
            cursor = page.nextSequence;
            await db.query('UPDATE hosted_branches SET cursor=$2 WHERE id=$1 AND cursor<$2', [branch.id, cursor]);
            if (!page.hasMore)
                break;
        }
        const snapshot = await runner.getRun(lookup);
        if (!snapshot.receipt)
            return;
        // Read events again on next tick if execution completed after our replay snapshot.
        const tail = await runner.events({ ...lookup, afterSequence: cursor, limit: 1 });
        if (tail.events.length)
            return;
        await db.transaction(async (tx) => {
            await tx.query('SELECT * FROM hosted_conversations WHERE owner=$1 AND artifact_id=$2 FOR UPDATE', [branch.owner, branch.artifact_id]);
            const current = (await tx.query<Branch>('SELECT * FROM hosted_branches WHERE id=$1 FOR UPDATE', [branch.id])).rows[0]!;
            if (!['pending', 'running'].includes(current.status))
                return;
            await tx.query('UPDATE hosted_branches SET status=$2,result=$3 WHERE id=$1', [branch.id, snapshot.status, JSON.stringify(snapshot.output ?? { receipt: snapshot.receipt })]);
            await tx.query('UPDATE hosted_conversations SET revision=revision+1 WHERE owner=$1 AND artifact_id=$2', [branch.owner, branch.artifact_id]);
        });
    }

    async function revoke(branch: Branch) {
        if (!branch.run_id) return;
        try { await runner.cancel({userId:branch.owner,runId:branch.run_id}); }
        catch (error) { if (!(error instanceof Error) || error.message !== 'not_found') throw error; }
        await db.query("UPDATE hosted_branches SET cancel_pending=false WHERE id=$1 AND status='cancelled'", [branch.id]);
    }

    return {dispatch,tick,
      async branches(userId:string,artifactId:string){return (await db.query<Branch>('SELECT * FROM hosted_branches WHERE owner=$1 AND artifact_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100',[userId,artifactId])).rows;},
      async cancel(userId:string,branchId:string){
        const row=(await db.query<Branch>('SELECT * FROM hosted_branches WHERE id=$1 AND owner=$2',[branchId,userId])).rows[0];if(!row)throw Error('not_found');
        const changed=(await db.query<Branch>("UPDATE hosted_branches SET status='cancelled',cancel_pending=(run_id IS NOT NULL) WHERE id=$1 AND owner=$2 AND status IN ('pending','running') RETURNING *",[branchId,userId])).rows[0];
        const cancelled=changed??(row.status==='cancelled'&&row.cancel_pending?row:undefined);
        if(cancelled?.run_id)await revoke(cancelled);
      }
    };
}
