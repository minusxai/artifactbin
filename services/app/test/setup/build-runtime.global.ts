import { execFileSync } from 'child_process';
import path from 'path';
import type { TestProject } from 'vitest/node';
import { serverReaderFresh } from '../../scripts/server-reader-cache.mjs';
import { removeHtmlAssets } from './html-assets-file';

declare module 'vitest' {
  interface ProvidedContext { readerAssetsRequired?: boolean; }
}

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_html_assets_file__: string | undefined;
}

export default async function buildStoryRuntime(project: TestProject): Promise<(() => Promise<void>) | void> {
  // The local wrapper proves an app-free Vite import graph. Unknown/direct runners still build.
  if (project.getProvidedContext().readerAssetsRequired === false) return;
  const appRoot = path.resolve(__dirname, '../..');
  // THE PAGE RUNTIME, ONCE PER RUN (./html-assets-file): the first worker to serve a page compiles it into this run's
  // file and the rest read it. Every project that shares it names the same file (this setup runs once per project), and
  // no other run's: one stopped before its teardown leaves its file behind, under a name no later run reads.
  let teardown: (() => Promise<void>) | undefined;
  if (project.getProvidedContext().htmlAssetsShared) {
    const file = (globalThis.__artifact_bin_html_assets_file__ ??= path.resolve(appRoot, '../../tmp/html-runtime-assets', `${process.pid}-${Date.now()}.json`));
    project.provide('htmlAssetsFile', file);
    teardown = async () => removeHtmlAssets(file);
  }
  if (serverReaderFresh()) console.log('build-server-reader: inputs unchanged, skipping rebuild (cache hit)');
  else execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-server-reader.mjs'), '--cache'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
  return teardown;
}
