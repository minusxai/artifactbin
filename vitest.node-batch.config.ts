import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';
import full from './vitest.config';
import { laneFiles, nodeBatchFiles } from './scripts/lib/node-batch.mjs';
import { schemaImageDir, suiteEnv } from './scripts/lib/suite-env.mjs';
import TimedSequencer from './scripts/lib/timed-sequencer.mjs';
import { readTimings } from './scripts/lib/timed-sequencer.mjs';

// PR FAST'S NODE BATCH (scripts/lib/node-batch.mjs): the full suite's cheap `node` files, one shared module graph per
// worker. The candidates are exactly the `node` project's files (its include and exclude, read from vitest.config.ts);
// each keeps the full suite's environment, global setup and setup file, so it runs here as it does after the merge.
// pr fast shards it by measured time (`--shard`, the timed sequencer), each file once.
const root = import.meta.dirname;
const nodeProject = (full.test?.projects as TestProjectInlineConfiguration[]).find((project) => project.test?.name === 'node')!.test!;
const candidates = globSync(nodeProject.include!, { cwd: root, exclude: nodeProject.exclude }).map((file) => file.split(path.sep).join('/'));
const files = nodeBatchFiles({ timings: readTimings(), candidates, lane: laneFiles(root), read: (file: string) => readFileSync(path.join(root, file), 'utf8') });

export default defineConfig({
  root,
  resolve: { alias: { '@': path.resolve(root, 'services/app') } },
  test: {
    globals: true,
    sequence: { sequencer: TimedSequencer },
    testTimeout: 45_000,
    hookTimeout: 45_000,
    globalSetup: ['./services/app/test/setup/build-runtime.global.ts'],
    env: suiteEnv(root),
    provide: { schemaImageDir: schemaImageDir(root) },
    projects: [{
      extends: true,
      test: {
        name: 'node-batch',
        environment: 'node',
        isolate: false,
        include: files,
        // The full suite's setup, then the check that a file left the builtins as it found them.
        setupFiles: ['./services/app/test/setup/vitest.setup.ts', './services/app/test/setup/shared-graph.setup.ts'],
      },
    }],
  },
});
