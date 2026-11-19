#!/usr/bin/env node
/** THE BROWSER SERVICE AS A PROCESS: `node server`. APP__PORT (default 8080). */
import { createEnv, log, serviceSecretForServer } from '@artifactbin/utils';
import { serveBrowser } from './index';
import { createBrowser } from './local';
import { sessionProcessOptions } from './session-config';
import { useLoopbackLookup } from '@artifactbin/utils/node/loopback-lookup';

// The app it renders may be addressed by a loopback name (`app.lvh.me`, `<hex id>.lvh.me`): never asked of DNS.
useLoopbackLookup();

const { env } = createEnv(process.env);
const port = Number(env('APP', 'PORT') ?? '8080');
const serviceSecret = serviceSecretForServer(process.env);
const browser = createBrowser({ sessions: sessionProcessOptions(process.env) });
// BROWSER__RENDER_SANDBOX=chromium: a host that cannot sandbox Chromium refuses to start here, by name, before it listens.
await browser.start();
const listening = serveBrowser(browser, { ...(serviceSecret ? { serviceSecret } : {}) }).listen(port, '0.0.0.0');
log('browser').info(`listening on ${listening.url}`);
