/**
 * Writes the generated plugin (see lib/plugin-package.ts) to `plugin/`
 * (gitignored) for local `claude --plugin-dir ./plugin` testing.
 * Usage: npm run build:plugin [-- --base <url>]
 */
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { buildPluginFiles, PLUGIN_BASE_URL } from '../lib/plugin-package';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseFlag = process.argv.indexOf('--base');
const base = baseFlag !== -1 ? process.argv[baseFlag + 1] : PLUGIN_BASE_URL;
if (!base || !/^https?:\/\//.test(base)) throw new Error(`--base must be an http(s) URL, got: ${base}`);

const pluginDir = path.join(repoRoot, 'plugin');
rmSync(pluginDir, { recursive: true, force: true });
const files = buildPluginFiles(base);
for (const [rel, content] of Object.entries(files)) {
  const full = path.join(pluginDir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

console.log(`plugin/ (${Object.keys(files).length} files) written for ${base}`);
