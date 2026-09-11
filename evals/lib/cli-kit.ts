/** Stage the built CLI outside the protected checkout; an eval never falls back to a global afbin. */
import {copyFileSync,mkdirSync,chmodSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function materializeCli(dir:string,source=fileURLToPath(new URL('../../services/cli/dist/afbin.mjs',import.meta.url))):string{
 if(!existsSync(source))throw new Error('Build the CLI before running evals: npm run build -w services/cli');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const executable=path.join(dir,'afbin');copyFileSync(source,executable);chmodSync(executable,0o755);
 return dir;
}
