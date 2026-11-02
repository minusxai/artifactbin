import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createVitest } from 'vitest/node';
import { auditFastTests } from '../lib/fast-test-audit.mjs';
import { assertFullTestCoverage, partitionFastTests } from '../lib/fast-test-policy.mjs';

// Discover the unchanged full-suite configuration without starting its build/setup.
const vitest = await createVitest('test', {run:true,watch:false,config:'vitest.config.ts'});
let full;
try { full = (await vitest.globTestSpecifications()).map(spec => path.relative(process.cwd(),spec.moduleId).split(path.sep).join('/')); }
finally { await vitest.close(); }
const discovered = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(file => /\.test\.(?:mjs|[jt]sx?)$/.test(file));
assertFullTestCoverage(discovered, full);
const enrolled = JSON.parse(readFileSync('scripts/ci/fast-tests.json', 'utf8'));
const { fast } = partitionFastTests(full, enrolled);
await auditFastTests(fast);
console.log(`Fast capability audit: ${fast.length} files; full suite enrollment unchanged.`);
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs','run','--config','vitest.fast.config.ts'], {stdio:'inherit'});
process.exitCode = result.status ?? 1;
