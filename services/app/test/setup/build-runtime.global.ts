import { execFileSync } from 'child_process';
import path from 'path';
import type { TestProject } from 'vitest/node';
import { serverReaderFresh } from '../../scripts/server-reader-cache.mjs';
import { buildHtmlAssets } from '@/lib/html-runtime/server';
import { removeHtmlAssets, writeHtmlAssets } from './html-assets-file';

declare module 'vitest' {
  interface ProvidedContext { readerAssetsRequired?: boolean; }
}

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_html_assets__: { file: string; written: Promise<void> } | undefined;
}

export default async function buildStoryRuntime(project: TestProject): Promise<(() => Promise<void>) | void> {
  // The local wrapper proves an app-free Vite import graph. Unknown/direct runners still build.
  if (project.getProvidedContext().readerAssetsRequired === false) return;
  const appRoot = path.resolve(__dirname, '../..');
  // THE PAGE RUNTIME, ONCE PER RUN (./html-assets-file): started first and never awaited here, so it builds while the
  // server reader is checked and the workers import their graphs. Every project that shares it reads the same file
  // (this setup runs once per project, so the build is held on the process).
  let teardown: (() => Promise<void>) | undefined;
  if (project.getProvidedContext().htmlAssetsShared) {
    const shared = (globalThis.__artifact_bin_html_assets__ ??= (() => {
      const file = path.resolve(appRoot, '../../tmp/html-runtime-assets', `${process.pid}.json`);
      removeHtmlAssets(file);
      return { file, written: writeHtmlAssets(file, buildHtmlAssets()) };
    })());
    project.provide('htmlAssetsFile', shared.file);
    teardown = async () => {
      await shared.written;
      removeHtmlAssets(shared.file);
    };
  }
  if (serverReaderFresh()) console.log('build-server-reader: inputs unchanged, skipping rebuild (cache hit)');
  else execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/build-server-reader.mjs'), '--cache'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
  return teardown;
}
