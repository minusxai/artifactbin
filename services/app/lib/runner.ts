import {PUBLIC_BASE_URL} from './platform/config';
import type {CapabilityContext} from '../../runner/src/local';
import {runnerIdentity} from '../../runner/src/capabilities';
import {lambdaOperation} from './runner/operations';
import {resolveLambdaProgram} from './runner/resolve';
import {resolveProgramArtifact} from './runner/program';
import { createScheduler } from '../../runner/src/scheduler';
import type { Db } from './platform/db';
import { z } from 'zod';
import type { RunStart, RunnerJson, ScheduledExecution, ScheduleInput, SchedulerService } from '@artifactbin/contracts';
import { actorOf, attachActor } from '@artifactbin/utils';
import { actorForArtifacts, sessionActor, isCookieCredential } from './accounts/viewer';
import { canReadArtifact, getArtifactById } from './artifacts';
import { OPERATIONS } from './operations/registry';
import { runOperation } from './operations/http';
import { services } from './platform/services';
import { json, readJson, isCrossSiteRequest } from './http';
import {editHostedDocument} from './remote/tools';
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
    const body = await readJson(request);
    if (!body || typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 128)
        return json({ error: 'request_id_required' }, 400);
    try {
        const input = (body.input ?? null) as RunnerJson;
        const execution = await resolveArtifactExecution({userId,artifactId,input,cron:'* * * * *',timezone:'UTC'});
        return json(await services().runner.start({...execution,userId,input,requestId:`artifact:${artifactId}:${body.requestId}`}),202);
    } catch(error) { return runnerError(error); }
}
/** Resolve the latest readable server handler or owner-controlled native program at execution time. */
export async function resolveArtifactExecution(spec: ScheduleInput): Promise<ScheduledExecution> {
    const artifact = await getArtifactById(spec.artifactId);
    if (!artifact || artifact.deleted_at || !await canReadArtifact(artifact,{userId:spec.userId,email:null})) throw Error('not_found');
    if (artifact.format === 'program') {
        const native = await resolveProgramArtifact(spec.artifactId,spec.userId);
        if (!native) throw Error('not_found');
        const capabilities=await services().runner.capabilities?.();
        if(!capabilities?.managedProcesses)throw Error('native_runs_unavailable');
        const input=JSON.stringify(spec.input);
        if(new TextEncoder().encode(input).byteLength>8192)throw Error('program_input_too_large');
        const env={...native.env,ARTIFACTBIN_INPUT:input};
        if(new TextEncoder().encode(JSON.stringify(env)).byteLength>65536)throw Error('program_environment_too_large');
        return {...native,env};
    }
    const resolved = await resolveProgram(spec.artifactId,spec.userId);
    if (!resolved) throw Error('not_executable');
    return {artifactId:spec.artifactId,artifactVersion:resolved.version,program:resolved.program,
        document:resolved.document ?? {source:artifact.source ?? '',editId:artifact.edit_id}};
}
function runnerError(error: unknown) {
    const message = error instanceof Error ? error.message : 'runner_failed';
    return json({error:message},message === 'not_found' ? 404 : ['scheduler_unavailable','native_runs_unavailable'].includes(message) ? 503 : 400);
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
    // Internal transport addresses are never reader-facing artifact URLs.
    const headers = new Headers(request.headers);
    const publicUrl = new URL(PUBLIC_BASE_URL);
    headers.set('x-forwarded-host', publicUrl.host);
    headers.set('x-forwarded-proto', publicUrl.protocol.slice(0,-1));
    request = attachActor(new Request(new URL('/api/runner/operations', publicUrl), {method:request.method,headers}),identity);
    if(operation==='edit_document')return editHostedDocument(request,actor,input);
    const allowed = new Set(['create_artifact', 'get_artifact', 'query_resource', 'mutate_dataset', 'annotate', 'list_artifacts', 'update_artifact']);
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
let scheduler: SchedulerService | undefined;
/** Every app replica ticks; SQL leases and uniqueness coordinate the replicas. */
export async function startLambdaSchedules(db: Db) {
    scheduler = await createScheduler(db, services().runner, resolveArtifactExecution);
    const current = scheduler;
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => {
        if (!pending) pending = current.tick().catch(e => console.error('[schedules]',e instanceof Error ? e.message : 'tick failed')).finally(() => {pending=undefined;});
    },5000);
    timer.unref();
    return async () => {clearInterval(timer);await pending;if(scheduler===current)scheduler=undefined;};
}
/** Also used by integration checks; this uses the same durable SQL path as the timer. */
export async function tickSchedules() {if (!scheduler) throw Error('scheduler_unavailable');await scheduler.tick();}
const scheduleSchema = z.object({artifactId:z.string().min(1).max(128),cron:z.string().min(1).max(128),timezone:z.string().min(1).max(128),input:z.unknown().optional(),maxAttempts:z.number().int().min(1).max(10).optional(),retryBackoffSeconds:z.number().int().min(1).max(86400).optional()}).strict();
const patchSchema = scheduleSchema.omit({artifactId:true}).partial().extend({enabled:z.boolean().optional()}).strict();
export async function schedulesRequest(request: Request) {
    const userId=await user(request,request.method!=='GET');
    if(!userId)return json({error:'unauthorized'},401);
    if(!scheduler)return json({error:'scheduler_unavailable'},503);
    try {
        if(request.method==='GET')return json({schedules:await scheduler.list(userId)});
        const parsed=scheduleSchema.safeParse(await readJson(request));
        if(!parsed.success)return json({error:'invalid_schedule'},400);
        const {input,...values}=parsed.data;
        const spec:ScheduleInput={...values,userId,input:(input??null) as RunnerJson};
        // Validate authorization/executability now and again when each attempt starts.
        await resolveArtifactExecution(spec);
        return json(await scheduler.put(spec),201);
    }catch(error){return runnerError(error);}
}
export async function scheduleRequest(request:Request,id:string,action:'record'|'history'|'run'='record') {
    const userId=await user(request,request.method!=='GET');
    if(!userId)return json({error:'unauthorized'},401);
    if(!scheduler)return json({error:'scheduler_unavailable'},503);
    try {
        if(action==='history')return json({history:await scheduler.history(userId,id)});
        if(action==='run') {
            const body=await readJson(request);
            if(!body||typeof body.requestId!=='string'||!body.requestId||body.requestId.length>128)return json({error:'request_id_required'},400);
            return json(await scheduler.runNow(userId,id,body.requestId),202);
        }
        if(request.method==='GET')return json(await scheduler.get(userId,id));
        if(request.method==='DELETE'){await scheduler.remove(userId,id);return json({ok:true});}
        const parsed=patchSchema.safeParse(await readJson(request));
        if(!parsed.success||!Object.keys(parsed.data).length)return json({error:'invalid_schedule'},400);
        const patch=parsed.data as Parameters<SchedulerService['update']>[2];
        const existing=await scheduler.get(userId,id);
        await resolveArtifactExecution({...existing,...patch,userId});
        return json(await scheduler.update(userId,id,patch));
    }catch(error){return runnerError(error);}
}
/** Compatibility route; the global API is shared by the UI and npm CLI. */
export async function artifactSchedule(request:Request,artifactId:string) {
    if(request.method==='GET') {
        const response=await schedulesRequest(request);
        if(!response.ok)return response;
        const data=await response.json() as {schedules:Array<{artifactId:string}>};
        return json({schedules:data.schedules.filter(item=>item.artifactId===artifactId)});
    }
    const body=await readJson(request);if(!body)return json({error:'invalid_schedule'},400);
    const forwarded=new Request(request.url,{method:'POST',body:JSON.stringify({...body,artifactId}),headers:request.headers});
    const actor=actorOf(request);
    return schedulesRequest(actor?attachActor(forwarded,actor):forwarded);
}
export function deleteSchedule(request:Request,id:string) {
    const forwarded=new Request(request.url,{method:'DELETE',headers:request.headers});const actor=actorOf(request);
    return scheduleRequest(actor?attachActor(forwarded,actor):forwarded,id);
}
