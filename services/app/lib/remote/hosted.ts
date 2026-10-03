import { createHash, createHmac, randomUUID } from 'node:crypto';
import { attachActor } from '@artifactbin/utils';
import type { RunnerService } from '@artifactbin/contracts';
import type { RemoteSessionInfo } from '../../../contracts/src/remote';
import { remoteColor } from '../../../contracts/src/remote';
import { getDb } from '../platform/db';
import { canReadArtifact, getArtifactById } from '../artifacts';
import { runnerOperation } from '../runner';
import { createAgentCoordinator } from '../../../runner/src/coordinator';
import type { HostedRemoteAgent } from './hosted-interface';
/** Production composition calls this explicitly. No provider keys or history enter remote terminal credentials. */
export async function createHostedRemoteAgent(options: {
    runner: RunnerService;
    secret: string;
    model: string;
}) {
    if (options.secret.length < 32)
        throw Error('Hosted agent secret must contain at least 32 characters');
    const db = await getDb(), coordinator = await createAgentCoordinator(db, options.runner);
    const identity = (owner: string) => createHmac('sha256', options.secret).update(`agent:${owner}`).digest('hex');
    const proof = (owner: string) => createHmac('sha256', options.secret).update(`proof:${owner}`).digest('hex');
    const pendingInput = new Map<string, string>();
    const agent: HostedRemoteAgent = {
        owns: (owner, id) => identity(owner) === id,
        async ensure(owner) {
            const id = identity(owner);
            const info: RemoteSessionInfo = { id, name: 'artifactbin', harness: 'pi', cwd: 'Artifactbin', machine: 'Hosted', cols: 100, rows: 30, online: true, exitCode: null, controller: 'web', createdAt: new Date().toISOString(), managed: true, color: remoteColor(id), activity: 'listening' };
            await db.query('INSERT INTO remote_agents(id,owner,name,proof_hash,info) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING', [id, owner, info.name, createHash('sha256').update(proof(owner)).digest('hex'), JSON.stringify(info)]);
            const row = (await db.query<{
                active: boolean;
                info: RemoteSessionInfo;
            }>('SELECT active,info FROM remote_agents WHERE id=$1 AND owner=$2', [id, owner])).rows[0]!;
            if (row.active)
                await db.query('UPDATE remote_agents SET seen_at=now() WHERE id=$1', [id]);
            return { ...row.info, online: row.active, controller: 'web' };
        },
        async view(owner, id, _since) {
            if (!agent.owns(owner, id))
                throw Error('not_found');
            const session = await agent.ensure(owner);
            const rows = await coordinator.branches(owner, 'chat');
            const lines = rows.slice().reverse().map(b => { const input = b.input as {
                message?: string;
                history?: unknown[];
            }; const output = b.result as {
                messages?: Array<{
                    role: string;
                    content?: Array<{
                        text?: string;
                    }>;
                }>;
            } | null; const text = output?.messages?.slice(input.history?.length ?? 0).filter(m => m.role === 'assistant').flatMap(m => m.content ?? []).map(c => c.text ?? '').join('\n'); return `> ${input.message ?? ''}\r\n${text || b.status}\r\n`; }).join('\r\n').slice(-128 * 1024).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') + '\r\n> ' + (pendingInput.get(owner) ?? '');
            return { session, generation: 'hosted-' + createHash('sha256').update(lines).digest('hex'), seq: rows.length, frames: [], snapshot: lines };
        },
        async input(owner, id, text) {
            if (!agent.owns(owner, id))
                throw Error('not_found');
            if (!(await agent.ensure(owner)).online)
                throw Error('agent_stopped');
            if (typeof text !== 'string' || text.length > 32000)
                throw Error('invalid_input');
            let buffer = pendingInput.get(owner) ?? '';
            for (const char of text) {
                if (char === '\r' || char === '\n') {
                    if (buffer.trim())
                        await coordinator.dispatch({ userId: owner, artifactId: 'chat', requestId: randomUUID(), message: buffer, model: options.model, instructions: 'Help this user with their Artifactbin workspace. Use available tools only when needed.' });
                    buffer = '';
                }
                else if (char === '\x7f' || char === '\b')
                    buffer = buffer.slice(0, -1);
                else if (char >= ' ')
                    buffer += char;
                if (buffer.length > 32000)
                    throw Error('input_limit');
            }
            pendingInput.set(owner, buffer);
        },
        async stop(owner, id) { if (!agent.owns(owner, id))
            throw Error('not_found'); const branches = (await db.query<{
            id: string;
        }>('SELECT id FROM hosted_branches WHERE owner=$1 AND status IN (\'pending\',\'running\')', [owner])).rows; for (const b of branches)
            await coordinator.cancel(owner, b.id); pendingInput.delete(owner); },
        async operation(owner, requestId, operation, args) {
            const branch = (await db.query<{
                artifact_id: string;
                input: {
                    context?: {
                        workId: string;
                        threadId: string;
                    };
                };
            }>("SELECT artifact_id,input FROM hosted_branches WHERE id=$1 AND owner=$2 AND status IN ('pending','running')", [requestId.replace(/^agent:/, ''), owner])).rows[0];
            if (!branch || !requestId.startsWith('agent:'))
                return Response.json({ error: 'not_found' }, { status: 404 });
            if (operation === 'history') {
                const query = args as {
                    branchId?: string;
                };
                const rows = query.branchId ? (await db.query('SELECT id,status,checkpoint,result FROM hosted_branches WHERE owner=$1 AND artifact_id=$2 AND id=$3', [owner, branch.artifact_id, query.branchId])).rows : (await coordinator.branches(owner, branch.artifact_id)).map(b => ({ id: b.id, status: b.status }));
                if (Buffer.byteLength(JSON.stringify(rows)) > 512 * 1024)
                    return Response.json({ error: 'history_response_limit' }, { status: 413 });
                return Response.json({ branches: rows });
            }
            if (branch.artifact_id === 'chat')
                return Response.json({ ok: true });
            const work = branch.input.context;
            if (!work)
                return Response.json({ error: 'work_context_missing' }, { status: 403 });
            const input = args as {
                body?: string;
                phase?: string;
            };
            const headers: Record<string, string> = {};
            if (operation === 'reply') {
                headers['X-Artifactbin-Remote-Session'] = identity(owner);
                headers['X-Artifactbin-Remote-Proof'] = proof(owner);
                headers['Idempotency-Key'] = `${work.workId}-${input.phase}`;
            }
            const request = attachActor(new Request('http://artifactbin.internal/api/runner/operations', { method: 'POST', headers }), { userId: owner, credential: 'session' });
            return runnerOperation(request, operation === 'read' ? 'get_artifact' : 'annotate', operation === 'read' ? { id: branch.artifact_id } : { id: branch.artifact_id, annotation_id: work.threadId, reply: input.body, phase: input.phase, request_id: work.workId });
        }
    };
    let ticking = false;
    async function tick() {
        if (ticking)
            return;
        ticking = true;
        try {
            const works = (await db.query<{
                id: string;
                owner: string;
                session_id: string;
                artifact_id: string;
                thread_id: string;
                data: {
                    payload: {
                        body: string;
                    };
                };
            }>("SELECT w.* FROM remote_work w JOIN remote_agents a ON a.id=w.session_id WHERE w.phase='queued' AND a.active=true ORDER BY w.seq LIMIT 100")).rows;
            for (const work of works) {
                if (!agent.owns(work.owner, work.session_id))
                    continue;
                const artifact = await getArtifactById(work.artifact_id);
                if (!artifact || artifact.deleted_at || !await canReadArtifact(artifact, { userId: work.owner, email: null })) {
                    await db.query("UPDATE remote_work SET phase='unavailable' WHERE id=$1", [work.id]);
                    continue;
                }
                await coordinator.dispatch({ userId: work.owner, artifactId: work.artifact_id, requestId: work.id, message: work.data.payload.body, model: options.model, context: { workId: work.id, threadId: work.thread_id } });
                await db.query("UPDATE remote_work SET phase='dispatching',updated_at=now() WHERE id=$1 AND phase='queued'", [work.id]);
            }
            await coordinator.tick();
            await db.query("UPDATE remote_work w SET phase='uncertain',updated_at=now() FROM hosted_branches b WHERE b.request_key=w.id AND b.owner=w.owner AND b.status IN ('failed','interrupted','cancelled') AND w.phase IN ('dispatching','delivered','acknowledged')");
        }
        finally {
            ticking = false;
        }
    }
    return { agent, tick, coordinator };
}
