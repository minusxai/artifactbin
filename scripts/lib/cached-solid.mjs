/**
 * vite-plugin-solid with its Babel transform remembered on disk, for the test runner.
 *
 * Every Vitest start used to re-run babel-preset-solid over the whole Solid module graph on the
 * main thread (~4 s of a single Solid page test, most of an affected `npm test`), because Vite keeps
 * transforms only in that process's memory. The result is a pure function of the source, the file
 * id, the server/client target and the plugin options, under the installed Babel/Solid versions, so
 * this keeps it in node_modules/.cache/solid-transform keyed by exactly those (the lockfile stands in
 * for the versions). A miss runs the plugin unchanged and stores what it returned.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import solid from 'vite-plugin-solid';

const VERSION = 1;
const sha = (text) => createHash('sha256').update(text).digest('hex');

/** @param {string} root @param {Parameters<typeof solid>[0]} options */
export function cachedSolid(root, options = {}) {
  const plugin = solid(options);
  const transform = plugin.transform;
  if (typeof transform !== 'function') return plugin;
  let lock = '';
  try { lock = readFileSync(path.join(root, 'package-lock.json'), 'utf8'); } catch { /* no lockfile: versions unkeyed */ }
  const scope = sha(JSON.stringify([VERSION, lock && sha(lock), options], (_, value) => value instanceof RegExp ? String(value) : value));
  const dir = path.join(root, 'node_modules/.cache/solid-transform', scope.slice(0, 16));
  let made = false;
  return {
    ...plugin,
    async transform(source, id, transformOptions) {
      // The plugin transforms only JSX files (no `extensions` option is used here); skip the rest unread.
      if (!/\.[mc]?[tj]sx$/i.test(id.replace(/\?.*$/, ''))) return transform.call(this, source, id, transformOptions);
      const ssr = this.environment ? this.environment.config.consumer === 'server' : Boolean(transformOptions?.ssr);
      const file = path.join(dir, `${sha(`${id}\0${ssr}\0${source}`)}.json`);
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch { /* miss */ }
      const result = await transform.call(this, source, id, transformOptions);
      if (result && typeof result === 'object' && typeof result.code === 'string') {
        try {
          if (!made) { mkdirSync(dir, { recursive: true }); made = true; }
          const temp = `${file}.${process.pid}.tmp`;
          writeFileSync(temp, JSON.stringify({ code: result.code, map: result.map ?? null }));
          renameSync(temp, file);
        } catch { /* a cache that cannot be written only costs the next run this transform */ }
      }
      return result;
    },
  };
}

/**
 * The bare `lucide-solid` import, for the test runner: only the icons the app declares.
 *
 * The package's index re-exports ~2,000 icon modules, and Vitest (which inlines the package so the
 * Solid transform applies) transformed and evaluated every one of them for each file that renders an
 * icon. services/app/solid/lucide-solid.d.ts already lists, as ES re-exports, every icon the app
 * imports from the bare specifier (tsc refuses any other), so this serves that list as the module:
 * an icon added there for the type check is what makes it importable in the tests too.
 */
export function declaredLucideIcons(root) {
  const declarations = path.join(root, 'services/app/solid/lucide-solid.d.ts');
  const id = '\0lucide-solid-declared';
  return {
    name: 'declared-lucide-icons',
    enforce: 'pre',
    resolveId(source) { return source === 'lucide-solid' ? id : null; },
    load(source) {
      if (source !== id) return null;
      return readFileSync(declarations, 'utf8').split('\n').filter((line) => /^export \{ default as \w+ \} from 'lucide-solid\/icons\/[\w-]+';$/.test(line)).join('\n');
    },
  };
}
