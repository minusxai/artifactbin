/** Run by scripts/ci/fast-check.mjs: audit full-suite ownership and each enrolled test's capabilities
 * (scripts/lib/fast-test-policy.mjs) while the pure module tests of scripts/ci/fast-tests.json run. */
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createVitest } from 'vitest/node';
import { auditFastTests } from '../lib/fast-test-audit.mjs';
import { assertFullTestCoverage, partitionFastTests } from '../lib/fast-test-policy.mjs';

// Discover the unchanged full-suite configuration without starting its build/setup.
// The fast list runs WHILE the audit below decides whether it may: the two are independent reads of the same tree,
// and in pr fast the audit's 5s (createVitest's glob and the capability audit, run 43042914246) came before 15s of
// tests on the `tests` runner, one of the run's slowest. Either failing fails this script; the audit's verdict still
// stands whatever the tests answer, and output is the tests' own.
const tests = spawn(process.execPath, ['node_modules/vitest/vitest.mjs','run','--config','vitest.fast.config.ts'], {stdio:'inherit'});
const testsExit = new Promise((resolve) => { tests.on('exit', (code, signal) => resolve(signal ? 1 : code ?? 1)); tests.on('error', () => resolve(1)); });
let fast;
try {
  const vitest = await createVitest('test', {run:true,watch:false,config:'vitest.config.ts'});
  let full;
  try { full = (await vitest.globTestSpecifications()).map(spec => path.relative(process.cwd(),spec.moduleId).split(path.sep).join('/')); }
  finally { await vitest.close(); }
  const discovered = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(file => /\.test\.(?:mjs|[jt]sx?)$/.test(file));
  assertFullTestCoverage(discovered, full);
  const enrolled = JSON.parse(readFileSync('scripts/ci/fast-tests.json', 'utf8'));
  ({ fast } = partitionFastTests(full, enrolled));
  await auditFastTests(fast);
} catch (error) {
  tests.kill();
  throw error;
}
console.log(`Fast capability audit: ${fast.length} files; full suite enrollment unchanged.`);
process.exitCode = await testsExit;
