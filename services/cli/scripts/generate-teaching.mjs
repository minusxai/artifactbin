// Build-time renderer may load server registries; none enter the CLI runtime graph.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
execFileSync(process.execPath,['--import','tsx','-r',fileURLToPath(new URL('../../../scripts/register-yaml.cjs',import.meta.url)),fileURLToPath(new URL('./compile-teaching.ts',import.meta.url)),...process.argv.slice(2)],{cwd:fileURLToPath(new URL('../../app/',import.meta.url)),stdio:'inherit'});
