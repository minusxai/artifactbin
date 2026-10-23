import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createVitest } from 'vitest/node';
import { build } from 'esbuild';
import { assertFullTestCoverage, auditFastSource, classifyFastGraph, partitionFastTests } from '../lib/fast-test-policy.mjs';

// Discover the unchanged full-suite configuration without starting its build/setup.
const vitest = await createVitest('test', {run:true,watch:false,config:'vitest.config.ts'});
let full;
try { full = (await vitest.globTestSpecifications()).map(spec => path.relative(process.cwd(),spec.moduleId).split(path.sep).join('/')); }
finally { await vitest.close(); }
const discovered = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(file => /\.test\.(?:mjs|[jt]sx?)$/.test(file));
assertFullTestCoverage(discovered, full);
const enrolled = JSON.parse(readFileSync('scripts/ci/fast-tests.json', 'utf8'));
const { fast } = partitionFastTests(full, enrolled);
for (const file of fast) {
  const result = await build({entryPoints:[file],bundle:true,write:false,metafile:true,platform:'node',format:'esm',external:['vitest','typescript'],logLevel:'silent'});
  if (result.warnings.length) throw new Error(`Unresolved fast graph: ${file}`);
  const sourceReasons = Object.keys(result.metafile.inputs).flatMap(input => auditFastSource(readFileSync(input,'utf8'),input));
  if (sourceReasons.length) throw new Error(`${file}: ${sourceReasons.join(', ')}`);
  const classification = classifyFastGraph(result.metafile);
  if (!classification.eligible) throw new Error(`Fast test acquired service capabilities: ${classification.reasons.join(', ')}`);
}
console.log(`Fast capability audit: ${fast.length} files; full suite enrollment unchanged.`);
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs','run','--config','vitest.fast.config.ts'], {stdio:'inherit'});
process.exitCode = result.status ?? 1;
