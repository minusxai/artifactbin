import type {CapabilityContext} from '../../runner/src/local';
import {runnerIdentity} from '../../runner/src/capabilities';
import {lambdaOperation} from './runner/operations';
import {resolveLambdaProgram} from './runner/resolve';
import { createScheduler } from '../../runner/src/scheduler';
import type { Db } from './platform/db';
import { z } from 'zod';
import type { RunStart, RunnerJson } from '@artifactbin/contracts';
import { actorOf, attachActor } from '@artifactbin/utils';
import { actorForArtifacts, sessionActor, isCookieCredential } from './accounts/viewer';
import { canReadArtifact, getArtifactById } from './artifacts';
import { OPERATIONS } from './operations/registry';
import { runOperation } from './operations/http';
import { services } from './platform/services';
import { json, readJson, isCrossSiteRequest } from './http';
/** Published JSX is the default resolver; deployments/tests may supply another trusted compiler. */
export type LambdaProgramResolver = (artifactId: string, userId: string) => Promise<{
    version: string;
    document?: RunStart['document'];
    program: RunStart['program'];
} | null>;
let resolveProgram: LambdaProgramResolver = resolveLambdaProgram;
export function setLambdaProgramResolver(resolver: LambdaProgramResolver | undefined) { resolveProgram = resolver ?? resolveLambdaProgram; }
async function user(request: Request, write = false) { const actor = await sessionActor(request); if (!actor.viewer?.userId)
    return null; if (write && isCookieCredential(actor) && isCrossSiteRequest(request))
    return null; return actor.viewer.userId; }
export async function invokeArtifact(request: Request, artifactId: string) {
    const userId = await user(request, true);
    if (!userId)
        return json({ error: 'unauthorized' }, 401);
    const artifact = await getArtifactById(artifactId);
    if (!artifact || artifact.deleted_at || !await canReadArtifact(artifact, { userId, email: null }))
        return json({ error: 'not_found' }, 404);
    let resolved: Awaited<ReturnType<LambdaProgramResolver>>;
    try { resolved = await resolveProgram(artifactId,userId); }
    catch(error) { return json({error:'invalid_lambda',detail:error instanceof Error?error.message:'Compilation failed'},400); }
    if (!resolved)
        return json({ error: 'not_executable' }, 400);
    const body = await readJson(request);
    if (!body || typeof body.requestId !== 'string')
        return json({ error: 'request_id_required' }, 400);
    return json(await services().runner.start({ userId, artifactId, artifactVersion: resolved.version, requestId: `artifact:${artifactId}:${body.requestId}`, program: resolved.program, ...(resolved.document?{document:resolved.document}:{}), input: (body.input ?? null) as RunnerJson }), 202);
}
export async function runRequest(request: Request, runId: string, action: 'get' | 'events' | 'cancel') {
    const userId = await user(request, action === 'cancel');
    if (!userId)
        return json({ error: 'unauthorized' }, 401);
    try {
        if (action === 'cancel') {
            await services().runner.cancel({ userId, runId });
            return json({ ok: true });
        }
        if (action === 'get')
            return json(await services().runner.getRun({ userId, runId }));
        const url = new URL(request.url);
        return json(await services().runner.events({ userId, runId, afterSequence: Number(url.searchParams.get('after') ?? 0), limit: Number(url.searchParams.get('limit') ?? 100) }));
    }
    catch (e) {
        return json({ error: e instanceof Error ? e.message : 'runner_failed' }, e instanceof Error && e.message === 'not_found' ? 404 : 400);
    }
}
/** Trusted host uses the same operation registry and ACLs as the CLI. No caller-controlled identity. */
export async function runnerOperation(request: Request, operation: string, input: Record<string, unknown>, documentSource?:string) {
    if(operation.startsWith('lambda_'))return lambdaOperation(request,operation,input,documentSource);
    const identity = actorOf(request);
    if (!identity?.userId)
        return json({ error: 'unauthorized' }, 401);
    const caller = await sessionActor(request);
    if (isCookieCredential(caller) && isCrossSiteRequest(request))
        return json({ error: 'forbidden' }, 403);
    const actor = actorForArtifacts(caller);
    if (!actor)
        return json({ error: 'unauthorized' }, 401);
    const allowed = new Set(['get_artifact', 'query_resource', 'mutate_dataset', 'annotate', 'list_artifacts', 'update_artifact']);
    if (!allowed.has(operation))
        return json({ error: 'operation_not_allowed' }, 403);
    const spec = OPERATIONS.find(op => op.name === operation)!;
    const parsed = z.object(spec.input).safeParse(input);
    if (!parsed.success)
        return json({ error: 'invalid_operation_input' }, 400);
    return runOperation(operation, request, actor, parsed.data);
}
export function localRunnerOperation(userId: string, operation: string, input: Record<string, unknown>, context?:CapabilityContext) {
    return runnerOperation(attachActor(new Request('http://artifactbin.internal/internal/runner/operations', { method: 'POST' }), context?runnerIdentity(context):{ userId, credential: 'session' }), operation, input, context?.request.document?.source);
}
let scheduler: Awaited<ReturnType<typeof createScheduler>> | undefined;
export async function startLambdaSchedules(db: Db) {
    scheduler = await createScheduler(db, services().runner, async (spec) => { const artifact = await getArtifactById(spec.artifactId); return !!artifact && !artifact.deleted_at && await canReadArtifact(artifact, { userId: spec.userId, email: null }); });
    const current = scheduler;
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => { if (!pending)
        pending = current.tick().catch(e => console.error('[lambda-schedules]', e instanceof Error ? e.message : 'tick failed')).finally(() => { pending = undefined; }); }, 1000);
    timer.unref();
    return async () => { clearInterval(timer); await pending; if (scheduler === current)
        scheduler = undefined; };
}
export async function artifactSchedule(request: Request, artifactId: string) {
    const userId = await user(request, request.method !== 'GET');
    if (!userId)
        return json({ error: 'unauthorized' }, 401);
    if (!scheduler)
        return json({ error: 'scheduler_unavailable' }, 503);
    if (request.method === 'GET')
        return json({ schedules: (await scheduler.list(userId)).filter(s => s.spec.artifactId === artifactId) });
    const artifact = await getArtifactById(artifactId);
    if (!artifact || artifact.deleted_at || !await canReadArtifact(artifact, { userId, email: null }))
        return json({ error: 'not_found' }, 404);
    let resolved: Awaited<ReturnType<LambdaProgramResolver>>;
    try { resolved = await resolveProgram?.(artifactId,userId) ?? null; }
    catch(error) { return json({error:'invalid_lambda',detail:error instanceof Error?error.message:'Compilation failed'},400); }
    if (!resolved)
        return json({ error: 'not_executable' }, 400);
    const body = await readJson(request);
    if (!body || typeof body.cron !== 'string' || typeof body.timezone !== 'string')
        return json({ error: 'invalid_schedule' }, 400);
    try {
        return json(await scheduler.put({ userId, artifactId, version: resolved.version, program: resolved.program, ...(resolved.document?{document:resolved.document}:{}), cron: body.cron, timezone: body.timezone, input: (body.input ?? null) as RunnerJson }), 201);
    }
    catch {
        return json({ error: 'invalid_schedule' }, 400);
    }
}
export async function deleteSchedule(request: Request, id: string) { const userId = await user(request, true); if (!userId)
    return json({ error: 'unauthorized' }, 401); if (!scheduler)
    return json({ error: 'scheduler_unavailable' }, 503); try {
    await scheduler.remove(userId, id);
    return json({ ok: true });
}
catch {
    return json({ error: 'not_found' }, 404);
} }
