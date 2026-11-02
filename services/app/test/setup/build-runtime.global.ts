import { execFileSync } from 'child_process';
import path from 'path';
import type { TestProject } from 'vitest/node';
import { serverReaderFresh } from '../../scripts/server-reader-cache.mjs';

declare module 'vitest' {
  interface ProvidedContext { readerAssetsRequired?: boolean; }
}

export default async function buildStoryRuntime(project: TestProject): Promise<void> {
  // The local wrapper proves an app-free Vite import graph. Unknown/direct runners still build.
  if (project.getProvidedContext().readerAssetsRequired === false) return;
  const appRoot = path.resolve(__dirname, '../..');
  if (serverReaderFresh()) console.log('build-server-reader: inputs unchanged, skipping rebuild (cache hit)');
  else execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-server-reader.mjs'), '--cache'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
}
