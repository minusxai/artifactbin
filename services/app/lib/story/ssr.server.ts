import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { IS_DEV } from '@/lib/config';
import type { StorySsrBundle } from '@/lib/story-runtime/contract';

let cached: StorySsrBundle | null = null;
/** Shared prebuilt renderer; never import the browser entry into the app. */
export function loadStorySsr(): StorySsrBundle {
  const req = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href);
  const file = path.join(process.cwd(), 'lib', 'story-runtime', 'dist', 'story-ssr.cjs');
  if (IS_DEV) delete req.cache[req.resolve(file)];
  else if (cached) return cached;
  const bundle = req(file) as StorySsrBundle;
  if (!IS_DEV) cached = bundle;
  return bundle;
}
