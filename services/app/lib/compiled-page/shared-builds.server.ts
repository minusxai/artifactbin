/** Retain immutable shared island files beyond the deployment that produced them. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { objectStore, ObjectUnavailable } from '@/lib/object-store';
import type { CompilerBuild } from './contract';

const keyOf = (name: string): string => `island-builds/${name}`;
const fileOf = (name: string): string => path.join(process.cwd(), 'public/islands', name);
const safeName = (name: string): boolean => /^[a-z0-9][a-z0-9-]*-[0-9a-f]{16}\.(?:js|wasm)$/.test(name);
let archiving: Promise<void> | null = null;
let archived = '';

/** Called before storing a compile: every URL it can name is durable first. */
export function archiveSharedBuild(build: CompilerBuild): Promise<void> {
  if (archived === build.id) return Promise.resolve();
  if (archiving) return archiving;
  archiving = (async () => {
    const manifest = JSON.parse(readFileSync(fileOf('manifest.json'), 'utf8')) as { build: string; files: Record<string, unknown>; ssr: { url: string } };
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
    archived = build.id;
  })().finally(() => { archiving = null; });
  return archiving;
}

export async function retainedIslandFile(name: string): Promise<Buffer | null> {
  if (!safeName(name)) return null;
  try { return await objectStore().get(keyOf(name)); }
  catch (error) { if (error instanceof ObjectUnavailable) return null; throw error; }
}
