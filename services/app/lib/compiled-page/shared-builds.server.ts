/**
 * Retain immutable shared island files beyond the deployment that produced them — and each build's
 * manifest, by id, so a page assembled for an older build (a tab open across a deploy, a prefetched
 * document, a stored page served pinned until its background recompile) can still be bound to that
 * build's own coherent set of chunks (runtime-binding.ts).
 */
import { readFileSync } from 'node:fs';
import { objectStore, ObjectUnavailable } from '@/lib/object-store';
import { islandFile, parseCompilerBuild } from './build.server';
import type { CompilerBuild } from './contract';

const keyOf = (name: string): string => `island-builds/${name}`;
const manifestKey = (id: string): string => `island-builds/manifest-${id}.json`;
const safeName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*-[0-9a-f]{16}\.(?:js|wasm)$/.test(name);
let archiving: Promise<void> | null = null;
let archived = '';

/**
 * Called at server start and before storing a compile: every URL a page of this build can name is durable first.
 * The names are the build's own (`graph` ∪ `ssr`); `read` gives a file's bytes (this server's public/islands by default).
 */
export function archiveSharedBuild(build: CompilerBuild, read: (name: string) => Buffer = (name) => readFileSync(islandFile(name))): Promise<void> {
  if (archived === build.id) return Promise.resolve();
  if (archiving) return archiving;
  archiving = (async () => {
    // Archived already (by an earlier process of this deploy): the manifest is written last, so all is there.
    if (await objectStore().get(manifestKey(build.id)).then(() => true, () => false)) { archived = build.id; return; }
    const manifest = read('manifest.json');
    if (parseCompilerBuild(manifest.toString('utf8'), 'manifest.json').id !== build.id) throw new Error('island build changed while archiving');
    const urls = [...Object.keys(build.graph ?? {}), ...(build.ssr ? [build.ssr.url] : [])];
    const names = [...new Set(urls.map((url) => url.slice('/islands/'.length)))];
    if (names.some((name) => !safeName(name))) throw new Error('invalid island file in build manifest');
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, names.length) }, async () => {
      while (next < names.length) {
        const name = names[next++]!;
        await objectStore().put(keyOf(name), read(name), name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      }
    }));
    // The manifest last: once it is retrievable, every file it names already is.
    await objectStore().put(manifestKey(build.id), manifest, 'application/json');
    archived = build.id;
  })().finally(() => { archiving = null; });
  return archiving;
}

export async function retainedIslandFile(name: string): Promise<Buffer | null> {
  if (!safeName(name)) return null;
  try { return await objectStore().get(keyOf(name)); }
  catch (error) { if (error instanceof ObjectUnavailable) return null; throw error; }
}

const retained = new Map<string, Promise<CompilerBuild | null>>();
/** An archived build's manifest by id (cached per process: a build never changes), or null when this store never saw it. */
export function retainedBuild(id: string): Promise<CompilerBuild | null> {
  if (!/^[0-9a-f]{16}$/.test(id)) return Promise.resolve(null);
  let found = retained.get(id);
  if (!found) {
    found = (async () => {
      try {
        const bytes = await objectStore().get(manifestKey(id));
        return bytes ? parseCompilerBuild(bytes.toString('utf8'), manifestKey(id)) : null;
      } catch (error) { if (error instanceof ObjectUnavailable) return null; throw error; }
    })();
    // A miss is not cached: the build may be archived moments later by the server that owns it.
    found.then((build) => { if (!build) retained.delete(id); }, () => retained.delete(id));
    retained.set(id, found);
  }
  return found;
}
