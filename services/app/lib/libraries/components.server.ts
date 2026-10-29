/**
 * HOSTED HTML COMPONENT FILES (D20): `@afbin/<component>` resolves (lib/libraries componentImports) to
 * `/af/components/<component>.js`, this build's module from lib/build-assets/components (scripts/build/build-html-components).
 *
 *   /af/components/<component>.js   an entry: no version in the name, so `no-cache` + a strong ETag over the bytes
 *                                   (the same rule as /af/core.js, lib/http/revalidation): a deploy shows up on the next load.
 *   /af/components/chunk-<hash>.js  a shared chunk the entries import relatively: named by its content, so immutable.
 *
 * Public code only: no page, viewer or credential reaches these bytes, and the name is checked against the hosted list
 * before any file is read. Brotli is computed once per file; lib/document-serving/components.server chooses per request.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { isHostedComponent } from './index';

// Same package-cwd contract as lib/libraries/assets.server (public/) and the server-reader build output.
const componentDir = path.resolve('lib/build-assets/components');
export const COMPONENT_CHUNK = /^chunk-[a-z0-9]+\.js$/;
const brotli = promisify(zlib.brotliCompress);

export interface LoadedComponentFile { body: Buffer; br: Buffer; etag: string }
const loaded = new Map<string, { version: string; file: Promise<LoadedComponentFile> }>();

/** The file name a request may name, or null: a hosted entry or a content-addressed chunk. */
export function componentFile(file: string): string | null {
  if (COMPONENT_CHUNK.test(file)) return file;
  const match = /^([a-z][a-z0-9-]*)\.js$/.exec(file);
  return match && isHostedComponent(match[1]!) ? file : null;
}

/** This build's bytes of one hosted component file (entry or chunk); null when the name is not one or the build lacks it. */
export async function readComponentFile(file: string): Promise<Buffer | null> {
  return (await loadComponentFile(file))?.body ?? null;
}

export async function loadComponentFile(file: string): Promise<LoadedComponentFile | null> {
  const name = componentFile(file);
  if (!name) return null;
  // Keyed by size and mtime, so a development rebuild is picked up on the next request and an unchanged file is
  // read and compressed once.
  const info = await stat(path.join(componentDir, name)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (!info) { loaded.delete(name); return null; }
  const version = `${info.size}:${info.mtimeMs}`;
  const cached = loaded.get(name);
  if (cached?.version === version) return cached.file;
  const pending = (async () => {
    const body = await readFile(path.join(componentDir, name));
    const br = await brotli(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength } });
    return { body, br, etag: `"${createHash('sha256').update(body).digest('hex')}"` };
  })();
  pending.catch(() => { if (loaded.get(name)?.file === pending) loaded.delete(name); });
  loaded.set(name, { version, file: pending });
  return pending;
}
