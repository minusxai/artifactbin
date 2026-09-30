/**
 * Retain immutable shared island files beyond the deployment that produced them — and each build's
 * manifest, by id, so a page assembled for an older build (a tab open across a deploy, a prefetched
 * document, a stored page served pinned until its background recompile) can still be bound to that
 * build's own coherent set of chunks (runtime-binding.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { objectStore, ObjectUnavailable } from '@/lib/object-store';
import { parseCompilerBuild } from './build.server';
import type { CompilerBuild } from './contract';

const keyOf = (name: string): string => `island-builds/${name}`;
const fileOf = (name: string): string => path.join(process.cwd(), 'public/islands', name);
const manifestKey = (id: string): string => `island-builds/manifest-${id}.json`;
const safeName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*-[0-9a-f]{16}\.(?:js|wasm)$/.test(name);
let archiving: Promise<void> | null = null;
let archived = '';

/** Called at server start and before storing a compile: every URL a page of this build can name is durable first. */
export function archiveSharedBuild(build: CompilerBuild): Promise<void> {
  if (archived === build.id) return Promise.resolve();
  if (archiving) return archiving;
  archiving = (async () => {
    const text = readFileSync(fileOf('manifest.json'), 'utf8');
    const manifest = JSON.parse(text) as { build: string; files: Record<string, unknown>; ssr: { url: string } };
    if (manifest.build !== build.id) throw new Error('island build changed while archiving');
    const names = [...new Set([...Object.keys(manifest.files), manifest.ssr.url].map((url) => url.slice('/islands/'.length)))];
    if (names.some((name) => !safeName(name))) throw new Error('invalid island file in build manifest');
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, names.length) }, async () => {
      while (next < names.length) {
        const name = names[next++]!;
        await objectStore().put(keyOf(name), readFileSync(fileOf(name)), name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      }
    }));
    // The manifest last: once it is retrievable, every file it names already is.
    await objectStore().put(manifestKey(build.id), Buffer.from(text), 'application/json');
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
