/**
 * `--changed` selection with a persistent import-edge cache (`npm test`, and pr fast's node runners: scripts/ci/node-affected.mjs).
 *
 * Vitest's own `--changed` filter transforms every test file's whole import graph on every start
 * (~10 s here), because the edges it walks live only in that process's Vite module graph. This module
 * applies the SAME rule (Vitest's VCS changed-file list, its forceRerunTriggers, and the edges Vite's
 * SSR transform reports, node_modules excluded) but remembers each file's edges keyed by project and
 * content hash, so an unchanged file is never transformed just to be walked. A file whose content
 * changed (or that has no entry) is transformed by its project's Vite environment exactly as Vitest
 * would. The whole cache is dropped when the Vitest/TypeScript configuration or the lockfile changes.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pm from 'picomatch';

const VERSION = 2;
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

function configKey(root) {
  const hash = createHash('sha256').update(String(VERSION));
  for (const file of ['vitest.config.ts', 'tsconfig.json', 'package-lock.json']) {
    hash.update(`\0${file}\0`);
    try { hash.update(readFileSync(path.join(root, file))); } catch { hash.update('missing'); }
  }
  return hash.digest('hex');
}

function loadCache(file, key) {
  try {
    const cache = JSON.parse(readFileSync(file, 'utf8'));
    if (cache.key === key && cache.edges && typeof cache.edges === 'object') return cache;
  } catch { /* none or unreadable: start empty */ }
  return { key, edges: {} };
}

/** The test specifications whose own file or import graph includes a changed file. */
export async function changedSpecifications(vitest, changedSince) {
  const root = vitest.config.root;
  const related = [...new Set(await vitest.vcs.findChangedFiles({ root, changedSince }))];
  return (await affectedSpecifications(vitest, related)).map(({ spec }) => spec);
}

/**
 * The same selection for a given list of changed files (absolute paths), each chosen specification with `distance`: how
 * many imports from the test file the nearest changed file is (0 is the test file itself). A changed forceRerunTrigger
 * selects every specification, each at distance Infinity: none is nearer the change than another.
 */
export async function affectedSpecifications(vitest, changed) {
  const related = [...new Set(changed)];
  const specs = await vitest.globTestSpecifications();
  const triggers = vitest.config.forceRerunTriggers ?? [];
  const matcher = triggers.length ? pm(triggers) : undefined;
  if (matcher && related.some((file) => matcher(file))) return specs.map((spec) => ({ spec, distance: Infinity }));
  if (!related.length) return [];

  const graphs = await specificationGraphs(vitest, specs);
  return specs.flatMap((spec, i) => {
    const distance = Math.min(...related.map((file) => graphs[i].get(file) ?? Infinity));
    return distance === Infinity ? [] : [{ spec, distance }];
  });
}

/** Walks every specification's import graph once, so the edge cache holds them all (main's warm-caches saves it). */
export async function cacheSpecificationGraphs(vitest) {
  return (await specificationGraphs(vitest, await vitest.globTestSpecifications())).length;
}

/** Walk the same Vite import edges for selection and asset provisioning; never guess from test names. */
async function specificationGraphs(vitest, specs) {
  const root = vitest.config.root;
  const cacheFile = path.join(root, 'node_modules/.cache/test-graph.json');
  const cache = loadCache(cacheFile, configKey(root));
  const used = {};
  let dirty = false;
  const stampOf = (file) => { const stat = statSync(file); return [stat.size, stat.mtimeMs]; };

  const pending = new Map();
  const edges = (project, file) => {
    const id = `${project.name}\0${file}`;
    if (!pending.has(id)) pending.set(id, fileEdges(project, file, id));
    return pending.get(id);
  };
  async function fileEdges(project, file, id) {
    const entry = cache.edges[id];
    const [size, mtimeMs] = stampOf(file);
    if (entry && entry.size === size && entry.mtimeMs === mtimeMs) return (used[id] = entry).deps;
    const contentHash = sha(readFileSync(file));
    if (entry && entry.sha === contentHash) {
      used[id] = { ...entry, size, mtimeMs }; dirty = true;
      return entry.deps;
    }
    const transformed = project.vite.environments.ssr.moduleGraph.getModuleById(file)?.transformResult
      || await project.vite.environments.ssr.transformRequest(file);
    if (!transformed) throw new Error(`Dependency discovery could not transform ${file} (${project.name}).`);
    const deps = [...new Set([...transformed.deps || [], ...transformed.dynamicDeps || []])]
      .map((dep) => dep.startsWith('/@fs/') ? dep.slice(4) : path.join(project.config.root, dep))
      .filter((dep) => !dep.includes('node_modules'));
    used[id] = { size, mtimeMs, sha: contentHash, deps }; dirty = true;
    return deps;
  }

  // Breadth first, so each file is recorded at its depth: how many imports from the test file it first appears.
  async function graph(spec) {
    const seen = new Map([[spec.moduleId, 0]]);
    let queue = [spec.moduleId];
    for (let depth = 1; queue.length; depth++) {
      const results = await Promise.all(queue.map((file) => edges(spec.project, file)));
      queue = [];
      for (const deps of results) for (const dep of deps) {
        if (!seen.has(dep) && existsSync(dep)) { seen.set(dep, depth); queue.push(dep); }
      }
    }
    return seen;
  }

  const graphs = await Promise.all(specs.map(graph));
  if (dirty) {
    try {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      const temporary = `${cacheFile}.${process.pid}.tmp`;
      // Keep entries this run did not visit (other projects' files), refreshed with what it did.
      writeFileSync(temporary, JSON.stringify({ key: cache.key, edges: { ...cache.edges, ...used } }));
      renameSync(temporary, cacheFile);
    } catch { /* the cache is an optimisation only */ }
  }
  return graphs;
}

/** App tests keep the full cold-build contract. Other tests skip it only with an app-free import graph.
 * Direct Vitest/IDE runs do not call this boundary and conservatively provision all assets. */
export async function needsReaderAssets(vitest, specs) {
  const app = path.join(vitest.config.root, 'services/app') + path.sep;
  if (specs.some(spec => spec.moduleId.startsWith(app))) return true;
  return (await specificationGraphs(vitest, specs)).some(graph => [...graph.keys()].some(file => file.startsWith(app)));
}
