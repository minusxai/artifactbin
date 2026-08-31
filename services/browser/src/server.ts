#!/usr/bin/env node
/** THE BROWSER SERVICE AS A PROCESS: `node server`. APP__PORT (default 8080). */
import { createEnv, log, serviceSecretForServer } from '@artifactbin/utils';
import { serveBrowser } from './index';
import { createBrowser } from './local';

const { env } = createEnv(process.env);
const port = Number(env('APP', 'PORT') ?? '8080');
const serviceSecret = serviceSecretForServer(process.env);
const listening = serveBrowser(createBrowser(), { ...(serviceSecret ? { serviceSecret } : {}) }).listen(port, '0.0.0.0');
log('browser').info(`listening on ${listening.url}`);
