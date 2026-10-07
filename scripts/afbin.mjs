#!/usr/bin/env node
// `npm run afbin -- <args>` — this branch's CLI, against THIS checkout's dev server,
// with its own state in ~/.artifactbin-dev/<port> and skills switched off. The port
// comes from scripts/lib/dev-env.mjs, exactly as `npm run dev` derives it: an exported
// APP__PORT wins over the .env this worktree carries.
import { loadDotEnv } from './lib/dev-env.mjs';
import { runAfbin } from './lib/afbin-run.mjs';

loadDotEnv();
process.exit(await runAfbin({ argv: process.argv.slice(2) }));
