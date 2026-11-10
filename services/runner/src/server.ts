/**
 * Standalone production controller. Run on a dedicated Linux host with Docker; never expose the Docker socket to
 * workers. Build the worker image from services/runner/Dockerfile and keep the settings in the service's protected
 * environment. One controller per `RUNNER__DATA_DIR`: it owns embedded PGlite storage (tables rendered with the
 * others by `npm run render:schema`) and is not horizontally replicated. The app reaches it with
 * `RUNNER__SERVICE_URL` and the same `CONTRACT__ACTOR_SECRET`; keep that connection private.
 * `.github/workflows/runner-design.yml` verifies the image, operation authority, OS restrictions and cleanup.
 */
import { PGlite } from '@electric-sql/pglite';
import { serve } from '@hono/node-server';
import { overHttp } from '@artifactbin/utils';
import { runnerConfig } from './config';
import { createRunner } from './local';
import { runnerHttp } from './http';
import { hostCapabilities, remoteArtifactbin } from './capabilities';
const config = runnerConfig(process.env);
if (!config.secret || config.secret.length < 32 || !config.image || !config.appUrl)
    throw Error('Standalone runner requires CONTRACT__ACTOR_SECRET (32+ characters), RUNNER__WORKER_IMAGE and RUNNER__ARTIFACTBIN_BASE_URL');
const db = new PGlite(config.dataDir);
const forward = overHttp(config.appUrl, config.secret);
const runner = await createRunner({ db, dockerImage: config.image, maxConcurrent: config.concurrent, database: { allowLoopback: config.databaseLoopback }, capabilities: hostCapabilities({ artifactbin: remoteArtifactbin(config.appUrl, forward) }) });
const server = serve({ fetch: runnerHttp(runner, config.secret).fetch, hostname: '0.0.0.0', port: config.port });
let closing = false;
async function close() { if (closing)
    return; closing = true; await new Promise<void>(r => server.close(() => r())); await runner.close(); await db.close(); }
process.once('SIGTERM', () => { void close(); });
process.once('SIGINT', () => { void close(); });
