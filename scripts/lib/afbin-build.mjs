/** The FAST compiler path for `npm run afbin`; production/package assembly stays in the CLI workspace. */
import { build } from 'esbuild';
import { access, chmod } from 'node:fs/promises';
import path from 'node:path';

import { cliBundle } from '../../services/cli/scripts/bundle-options.mjs';
import { generateTeaching } from './generate-teaching.mjs';

/** Bundle the branch CLI with the exact compiler options used by the package build. */
export async function buildAfbinDev(root) {
  const cli = path.join(root, 'services', 'cli');
  const entry = path.join(cli, 'src', 'main.ts');
  const teaching = path.join(cli, 'src', 'generated', 'teaching.json');
  try { await access(teaching); }
  catch { await generateTeaching(); }

  const outdir = path.join(cli, 'dist');
  await build({ ...cliBundle({ afbin: entry }), absWorkingDir: cli, outdir });
  await chmod(path.join(outdir, 'afbin.mjs'), 0o755);
}
