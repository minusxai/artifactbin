#!/usr/bin/env node
/**
 * Regenerate the `.env.example` snapshot inside `scripts/lib/setup-plan.mjs`.
 *
 * The planner cannot read `.env.example` at runtime: the runtime image ships
 * only the two setup modules (Dockerfile COPYs `scripts/setup.mjs` and
 * `scripts/lib/setup-plan.mjs`, nothing else), and `npm run setup` inside that
 * image must still render a complete file. So the example is carried as a
 * base64 constant — which is a SECOND COPY of a tracked file, and a second
 * copy drifts unless a machine writes it.
 *
 * This is that machine. Run it after editing `.env.example`:
 *
 *     node scripts/generate-env-snapshot.mjs
 *
 * `scripts/__tests__/setup-plan.test.mjs` asserts the two are byte-identical,
 * so a forgotten run is a red test rather than a planner that quietly plans
 * against a stale example.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = path.join(ROOT, 'scripts', 'lib', 'setup-plan.mjs');

const encoded = Buffer.from(readFileSync(path.join(ROOT, '.env.example'))).toString('base64');
const source = readFileSync(PLAN, 'utf8');
const line = /^const ENV_EXAMPLE_BASE64 = '[^']*';$/m;
if (!line.test(source)) throw new Error('setup-plan.mjs no longer declares ENV_EXAMPLE_BASE64 on one line');

const updated = source.replace(line, `const ENV_EXAMPLE_BASE64 = '${encoded}';`);
if (updated === source) {
  console.log('.env.example snapshot already current');
} else {
  writeFileSync(PLAN, updated);
  console.log(`.env.example snapshot regenerated (${encoded.length} base64 chars)`);
}
