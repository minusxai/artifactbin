/** Avoid shell-specific path/glob substitution when invoking native consumer proofs. */
import {readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const installed=(await readFile(join(process.env.RUNNER_TEMP??tmpdir(),'npm-proof/installed-path.txt'),'utf8')).trim();
const mode=process.argv[2];
const args=mode==='types'?['scripts/test-npm-types.mjs',installed]:mode==='runner'?['--import','tsx','scripts/test-npm-runner-boundary.mjs',installed]:mode==='terminal'?['scripts/test-npm-terminal.mjs',installed]:mode==='preview'?['--import','tsx','scripts/test-preview.ts',installed]:mode==='local'?['scripts/test-npm-local-journey.mjs',installed]:null;
if(!args)throw new Error('Choose types, runner, terminal, preview or local.');
execFileSync(process.execPath,args,{cwd:cli,stdio:'inherit',env:process.env,timeout:1200000});
