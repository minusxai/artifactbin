import { beforeEach, describe, expect, it, vi } from 'vitest';

const stage = vi.hoisted(() => ({ builds: [], generated: 0 }));
vi.mock('esbuild', () => ({
  build: async options => { stage.builds.push(options); },
}));
vi.mock('../lib/generate-teaching.mjs', () => ({
  generateTeaching: async () => { stage.generated++; return 'generated'; },
}));
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal(),
  chmod: async () => {},
}));

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cliBundle } from '../../services/cli/scripts/bundle-options.mjs';
import { buildAfbinDev } from '../lib/afbin-build.mjs';

beforeEach(() => { stage.builds = []; stage.generated = 0; });

describe('FAST afbin development bundle', () => {
  it('uses the production CLI bundle contract and only emits the executable entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'afbin-dev-build-'));
    const cli = join(root, 'services/cli');
    try {
      await mkdir(join(cli, 'src/generated'), { recursive: true });
      await writeFile(join(cli, 'src/main.ts'), 'void 0;');
      await writeFile(join(cli, 'src/generated/teaching.json'), '{}');

      await buildAfbinDev(root);

      const options = stage.builds[0];
      const canonical = cliBundle({ afbin: resolve(cli, 'src/main.ts') });
      expect(options.entryPoints).toEqual(canonical.entryPoints);
      expect(options.bundle).toBe(canonical.bundle);
      expect(options.platform).toBe(canonical.platform);
      expect(options.format).toBe(canonical.format);
      expect(options.target).toBe(canonical.target);
      expect(options.external).toEqual(canonical.external);
      expect(options.banner).toEqual(canonical.banner);
      expect(options.plugins.map(plugin => plugin.name)).toEqual(canonical.plugins.map(plugin => plugin.name));
      expect(options.absWorkingDir).toBe(cli);
      expect(options.outdir).toBe(join(cli, 'dist'));
      expect(stage.generated).toBe(0);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('generates the required teaching input when it is absent before bundling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'afbin-dev-build-'));
    try {
      await mkdir(join(root, 'services/cli/src'), { recursive: true });
      await writeFile(join(root, 'services/cli/src/main.ts'), 'void 0;');

      await buildAfbinDev(root);

      expect(stage.generated).toBe(1);
      expect(stage.builds).toHaveLength(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
