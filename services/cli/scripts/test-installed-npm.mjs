/** Avoid shell-specific path/glob substitution when invoking native consumer proofs. */
import {readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {runAcceptanceProcesses,installedAcceptanceModes} from './acceptance-processes.mjs';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const installed=(await readFile(join(process.env.RUNNER_TEMP??tmpdir(),'npm-proof/installed-path.txt'),'utf8')).trim();
const mode=process.argv[2];
const modes={types:['scripts/test-npm-types.mjs',installed],runner:['--import','tsx','scripts/test-npm-runner-boundary.mjs',installed],terminal:['scripts/test-npm-terminal.mjs',installed],preview:['--import','tsx','scripts/test-preview.ts',installed],local:['scripts/test-npm-local-journey.mjs',installed]};
const selected=installedAcceptanceModes(mode,process.argv.includes('--types'));
if(selected.some(name=>!modes[name]))throw new Error('Choose types, runner, terminal, preview, local or experience.');
await runAcceptanceProcesses(selected.map(label=>({label,command:process.execPath,args:modes[label],cwd:cli,env:process.env})));
