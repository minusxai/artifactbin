/** Standalone production controller. Run on a dedicated host; never expose the Docker socket to workers. */
import { PGlite } from '@electric-sql/pglite';
import { serve } from '@hono/node-server';
import { overHttp } from '@artifactbin/utils';
import { runnerConfig } from './config';
import { createRunner } from './local';
import { runnerHttp } from './http';
import { hostCapabilities, boundedJson } from './capabilities';
const config = runnerConfig(process.env);
if (!config.secret || config.secret.length < 32 || !config.image || !config.appUrl)
    throw Error('Standalone runner requires CONTRACT__ACTOR_SECRET (32+ characters), RUNNER__WORKER_IMAGE and RUNNER__ARTIFACTBIN_BASE_URL');
const db = new PGlite(config.dataDir);
const forward = overHttp(config.appUrl, config.secret);
const runner = await createRunner({ db, dockerImage: config.image, maxConcurrent: config.concurrent, capabilities: hostCapabilities({ ai: config.ai, artifactbin: async (context, operation, args) => {
            if (!operation.startsWith('artifactbin.') && !['read', 'reply'].includes(operation))
                throw Error('operation_not_allowed');
            const response = await forward(new Request(config.appUrl + '/api/runner/operations', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: context.signal, body: JSON.stringify({ operation: operation.startsWith('artifactbin.') ? operation.slice(12) : operation, input: args, requestId: context.request.requestId }) }), { userId: context.request.userId, credential: 'session' });
            if (context.observation)
                context.observation.status = response.status;
            if (!response.ok) {
                await response.body?.cancel();
                throw Error(`artifactbin_http_${response.status}`);
            }
            return boundedJson(response, 1024 * 1024);
        } }) });
const server = serve({ fetch: runnerHttp(runner, config.secret).fetch, hostname: '0.0.0.0', port: config.port });
let closing = false;
async function close() { if (closing)
    return; closing = true; await new Promise<void>(r => server.close(() => r())); await runner.close(); await db.close(); }
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
