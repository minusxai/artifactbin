/** Build boundary shared by source consumers, including cache-restored checkouts. */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function generateTeaching() {
  execFileSync(process.execPath, [fileURLToPath(new URL('../../services/cli/scripts/generate-teaching.mjs', import.meta.url))], {stdio: 'inherit'});
}
