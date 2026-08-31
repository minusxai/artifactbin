#!/usr/bin/env node
/**
 * THE ENTRY — the OSS image's `CMD`. Config from the process environment, the standalone composition
 * (src/standalone.ts) booted as-is, and the process's own concerns: signals and exit codes. A downstream
 * deployment writes its own entry of this shape against `@artifactbin/proxy` and never imports this file.
 */
import { pathToFileURL } from 'node:url';
import { loadProcessConfig } from './config';
import { runStandalone } from './standalone';

export { createStandaloneProxy, buildDeps, runStandalone, type StandaloneDeps, type BuiltDeps, type StandaloneOverrides, type RunningProxy } from './standalone';

async function main(): Promise<void> {
  const running = await runStandalone(loadProcessConfig());
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await running.close();
  };
  process.on('SIGTERM', () => { void close().finally(() => process.exit(0)); });
  process.on('SIGINT', () => { void close().finally(() => process.exit(0)); });
}

const isEntry = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
};

if (isEntry()) void main().catch((error) => { console.error('[boot] failed:', error); process.exit(1); });
