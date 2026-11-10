import { createHash } from 'node:crypto';
import { DATASET_ROLES, RESOLVER_DATABASE_CHECK_OPERATION, RESOLVER_LIMITS, runnerAdmissionOf, type Actor, type RunnerCaller, type RunnerJson, type Upstream } from '@artifactbin/contracts';
import type { CapabilityContext, RunnerOptions } from './local';
import { boundedJson } from './model.mjs';
export interface HostCapabilitiesOptions {
    /** This callback is trusted and must call the app's authenticated operation adapter. */
    artifactbin: (context: CapabilityContext, operation: string, args: RunnerJson) => Promise<RunnerJson>;
}
/** All destination selection and auth happen here, outside the isolate. */
export function hostCapabilities(options: HostCapabilitiesOptions): RunnerOptions['capabilities'] {
    return async (context, operation, args) => {
        if (context.signal.aborted)
            throw Error('run_revoked');
        const started = Date.now();
        const observation = { service: 'artifactbin', operation, durationMs: 0, status: null as number | null, requestId: null as string | null } as CapabilityContext['requests'][number];
        // The worker's per-query check is bookkeeping, not a request the receipt lists.
        if (operation !== RESOLVER_DATABASE_CHECK_OPERATION) context.requests.push(observation);
        try {
            return await options.artifactbin({ ...context, observation }, operation, args);
        }
        finally {
            observation.durationMs = Date.now() - started;
        }
    };
}

/** Identity and snapshot binding are chosen outside the program, on both transports. */
export function runnerIdentity(context: CapabilityContext): Actor {
    const {request, runId, callId} = context;
    const caller = admittedCaller(request.input);
    // A page function call's admission (part of the run's fingerprint, like the caller): the app re-decides it at every capability.
    const input = request.input, admission = input && typeof input === 'object' && !Array.isArray(input) && input.kind === 'invoke' ? runnerAdmissionOf(input.admission) : null;
    return {userId:request.userId,credential:'session',...(request.document && request.artifactId && request.artifactVersion && callId ? {runner:{pageBackendOperation:request.pageBackendOperation,runId,callId,artifactId:request.artifactId,version:request.artifactVersion,editId:request.document.editId,sourceHash:createHash('sha256').update(request.document.source).digest('hex'),...(caller ? {caller} : {}),...(admission ? {admission} : {})}} : {})};
}
/** The caller the app admitted a resolver call for (`input.principal`, part of the run's fingerprint); never program output. */
function admittedCaller(input: RunnerJson): RunnerCaller | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.kind !== 'invoke') return undefined;
    const p = input.principal;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined;
    if (!(p.subject === null || typeof p.subject === 'string') || typeof p.role !== 'string' || !(DATASET_ROLES as readonly string[]).includes(p.role)) return undefined;
    return { subject: p.subject, role: p.role as RunnerCaller['role'] };
}
/** A refusal the app may hand back to resolver code: a code, optionally with a short printable detail. */
const REFUSAL = /^[a-z][a-z_]{0,63}(?:: [\x20-\x7e]{1,200})?$/;
/**
 * The standalone controller's callback into the app. Replies are bounded by the same message cap as the
 * worker link; a refused call surfaces its code, as the in-process host's thrown error does.
 */
export function remoteArtifactbin(appUrl: string, forward: Upstream): HostCapabilitiesOptions['artifactbin'] {
    return async (context, operation, args) => {
        if (!operation.startsWith('artifactbin.') && !['read', 'reply'].includes(operation))
            throw Error('operation_not_allowed');
        const response = await forward(new Request(appUrl + '/api/runner/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: context.signal, body: JSON.stringify({ operation: operation.startsWith('artifactbin.') ? operation.slice(12) : operation, input: args, requestId: context.request.requestId, documentSource: context.request.document?.source }) }), runnerIdentity(context));
        if (context.observation)
            context.observation.status = response.status;
        if (!response.ok) {
            const refusal = await boundedJson(response, 4096).then((body: RunnerJson) => body && typeof body === 'object' && !Array.isArray(body) ? body.error : null, () => null);
            await response.body?.cancel().catch(() => {});
            throw Error(typeof refusal === 'string' && REFUSAL.test(refusal) ? refusal : `artifactbin_http_${response.status}`);
        }
        return boundedJson(response, RESOLVER_LIMITS.messageBytes);
    };
}
