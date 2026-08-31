#!/usr/bin/env node
// `npm run dev:app` — the APP-ONLY dev server: `tsx server.ts --app-only`
// (no proxy composition; human login and OAuth are deliberately absent — run
// `npm run dev` for the whole thing in one process, or point a proxy of your
// own at this port). Mirrors scripts/dev.mjs: .env → derived port → the
// story-runtime prebuild → the spawned entry, with the app's package dir as
// its cwd.
//
// dev:app's ONE contract of its own: the sql and browser services are LOCAL.
// A worktree's `.env` (or the caller's shell) may name SQL__SERVICE_URL /
// BROWSER__SERVICE_URL for the SPLIT shape — left in the child's env, every
// document query would die against a URL nothing is serving, with nothing
// saying why. So they are unset for the child, and ONE line says so when the
// environment carried them. The entry's own rule is unchanged — a URL that
// STILL reaches it wins (the neutralisation lives here, not in server.ts).
import { runDev } from './lib/dev-runner.mjs';

// A test harness exporting NODE_ENV=test must not leak it into this process;
// runDev also selects the app-only entry and neutralises split-service URLs.
await runDev({ appOnly: true });
