#!/usr/bin/env node
// `npm run dev` — starts next dev on the DERIVED port (scripts/lib/dev-env.mjs:
// PORT → the port in PUBLIC_BASE_URL → 3030), so a second checkout of this repo
// runs alongside the first by changing one line of its .env. Extra args pass
// through: `npm run dev -- --turbopack`.
import { runDev } from './lib/dev-runner.mjs';

// The co-hosted runner: the proxy in front of Next, one process (server.ts).
await runDev({ appOnly: false, args: process.argv.slice(2) });
