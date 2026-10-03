import type { RunnerService, Upstream } from '@artifactbin/contracts';
/** Identity is supplied by the authenticated app, signed by the configured Upstream. */
export function runnerClient(base: string, forward: Upstream): RunnerService {
    async function request<T>(userId: string, path: string, body?: unknown): Promise<T> {
        const response = await forward(new Request(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) }), { userId, credential: 'session' });
        const result = await response.json() as T & {
            error?: string;
        };
        if (!response.ok)
            throw Error(result.error ?? 'runner_unavailable');
        return result;
    }
    return { start: input => request(input.userId, '/v1/runs', input), getRun: input => request(input.userId, `/v1/runs/${encodeURIComponent(input.runId)}`), events: input => request(input.userId, `/v1/runs/${encodeURIComponent(input.runId)}/events?after=${input.afterSequence}&limit=${input.limit ?? 100}`), cancel: async (input) => { await request(input.userId, `/v1/runs/${encodeURIComponent(input.runId)}/cancel`, {}); } };
}
