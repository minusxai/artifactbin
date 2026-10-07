import { createHash } from 'node:crypto';
import type { Actor, RunnerJson } from '@artifactbin/contracts';
import type { CapabilityContext, RunnerOptions } from './local';
import { readModel, openaiMessages, boundedJson } from './model.mjs';
export interface HostCapabilitiesOptions {
    /** This callback is trusted and must call the app's authenticated operation adapter. */
    artifactbin: (context: CapabilityContext, operation: string, args: RunnerJson) => Promise<RunnerJson>;
    ai?: {
        baseUrl: string;
        apiKey?: string;
        models: string[];
        defaultModel: string;
        /** Explicit Chat Completions dialect; Fireworks uses max_tokens. */
        outputTokenField?: 'max_tokens' | 'max_completion_tokens';
        /** Host ceiling and default for every inference call. */
        maxOutputTokens?: number;
        headers?: (context: CapabilityContext) => Record<string, string>;
    };
}
/** All destination selection and auth happen here, outside the isolate. */
export function hostCapabilities(options: HostCapabilitiesOptions): RunnerOptions['capabilities'] {
    if(options.ai){const target=new URL(options.ai.baseUrl);if(!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash)throw Error('invalid_ai_endpoint');}
    const outputTokenField = options.ai?.outputTokenField ?? 'max_completion_tokens';
    if (!['max_tokens', 'max_completion_tokens'].includes(outputTokenField)) throw Error('invalid_ai_output_token_field');
    const hostOutputLimit = options.ai?.maxOutputTokens ?? 8192;
    if (!Number.isSafeInteger(hostOutputLimit) || hostOutputLimit <= 0) throw Error('invalid_ai_output_limit');
    const streams = new Map<string, {
        runId: string;
        message: RunnerJson;
        delivered: boolean;
    }>();
    return async (context, operation, args) => {
        if (context.signal.aborted)
            throw Error('run_revoked');
        if (operation === 'ai.next') {
            const key = String((args as Record<string, RunnerJson>)?.streamId);
            const entry = streams.get(key);
            if (!entry || entry.runId !== context.runId)
                throw Error('unknown_stream');
            if (entry.delivered) {
                streams.delete(key);
                return null;
            }
            entry.delivered = true;
            return entry.message;
        }
        const started = Date.now();
        const service = operation === 'ai.open' ? 'ai' : 'artifactbin';
        const observation = { service, operation, durationMs: 0, status: null as number | null, requestId: null as string | null } as CapabilityContext['requests'][number];
        context.requests.push(observation);
        // Reserve before awaiting: concurrent responses may finish in either order.
        const key = `${context.runId}:${context.requests.length}`;
        try {
            if (service === 'artifactbin')
                return await options.artifactbin({ ...context, observation }, operation, args);
            const ai = options.ai;
            if (!ai)
                throw Error('ai_unavailable');
            const input = args as {
                model?: string;
                maxOutputTokens?: number;
                context: Parameters<typeof openaiMessages>[0];
            };
            const model = input.model ?? ai.defaultModel;
            if (!ai.models.includes(model))
                throw Error('model_not_allowed');
            const requestedOutputLimit = input.maxOutputTokens === undefined ? hostOutputLimit : input.maxOutputTokens;
            if (!Number.isSafeInteger(requestedOutputLimit) || requestedOutputLimit <= 0) throw Error('invalid_ai_output_limit');
            const maxOutputTokens = Math.min(requestedOutputLimit, hostOutputLimit);
            const endpoint = new URL(ai.baseUrl.replace(/\/$/, '') + '/chat/completions');
            const response = await fetch(endpoint, { method: 'POST', redirect: 'manual', signal: context.signal, headers: { 'content-type': 'application/json', ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}), ...ai.headers?.(context) }, body: JSON.stringify({ model, [outputTokenField]: maxOutputTokens, stream: true, stream_options: { include_usage: true }, messages: [...(input.context.systemPrompt ? [{ role: 'system', content: input.context.systemPrompt }] : []), ...openaiMessages(input.context)], tools: input.context.tools?.map((t: {
                        name: string;
                        description?: string;
                        parameters: unknown;
                    }) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) }) });
            observation.status = response.status;
            observation.requestId = response.headers.get('x-request-id');
            if (response.status >= 300 && response.status < 400) {
                await response.body?.cancel();
                throw Error('managed_redirect_denied');
            }
            const message = await readModel(response);
            message.model = model;
            context.usage.push({ model, inputTokens: message.usage?.input ?? null, outputTokens: message.usage?.output ?? null });
            streams.set(key, { runId: context.runId, message: { type: 'done', reason: message.stopReason, message } as unknown as RunnerJson, delivered: false });
            context.signal.addEventListener('abort', () => { streams.delete(key); }, { once: true });
            return { streamId: key };
        }
        finally {
            observation.durationMs = Date.now() - started;
        }
    };
}
export { boundedJson };

/** Identity and snapshot binding are chosen outside the program, on both transports. */
export function runnerIdentity(context: CapabilityContext): Actor {
    const {request, runId, callId} = context;
    return {userId:request.userId,credential:'session',...(request.document && request.artifactId && request.artifactVersion && callId ? {runner:{runId,callId,artifactId:request.artifactId,version:request.artifactVersion,editId:request.document.editId,sourceHash:createHash('sha256').update(request.document.source).digest('hex')}} : {})};
}
