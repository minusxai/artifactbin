#!/usr/bin/env node
// `npm run dev` — starts the dev server on the DERIVED port (scripts/lib/dev-env.mjs:
// APP__PORT → the port in APP__PUBLIC_BASE_URL → 3030), so a second checkout of this
// repo runs alongside the first by changing one line of its .env. Extra args pass
// through to the entry.
import { runDev } from './lib/dev-runner.mjs';

// The co-hosted runner: authentication in front of the app, one process (server.ts).
await runDev({ appOnly: false, args: process.argv.slice(2) });
