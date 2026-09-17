#!/usr/bin/env node
/**
 * THE SQL SERVICE AS A PROCESS: `node server` — the engine behind `serveSql`.
 *   APP__PORT (default 8080) · SQL__MAX_ROWS · SQL__QUERY_TIMEOUT_MS
 */
import { createEnv, log, serviceSecretForServer } from '@artifactbin/utils';
import { serveSql } from './index';
import { createSql } from './local';

const { env } = createEnv(process.env);
const port = Number(env('APP', 'PORT') ?? '8080');
const maxRows = env('SQL', 'MAX_ROWS');
const timeoutMs = env('SQL', 'QUERY_TIMEOUT_MS');
const serviceSecret = serviceSecretForServer(process.env);
const svc = createSql({ ...(maxRows ? { maxRows: Number(maxRows) } : {}), ...(timeoutMs ? { timeoutMs: Number(timeoutMs) } : {}) });
const listening = serveSql(svc, { ...(serviceSecret ? { serviceSecret } : {}) }).listen(port, '0.0.0.0');
log('sql').info(`listening on ${listening.url}`);
