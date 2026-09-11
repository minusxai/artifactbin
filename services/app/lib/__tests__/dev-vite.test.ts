import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {developmentViteOptions} from '../dev-vite';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
it('scans an existing entry relative to the Vite web root',()=>{
 for(const entry of developmentViteOptions(appRoot,7242).optimizeDeps.entries)
  expect(existsSync(path.resolve(appRoot,'web',entry))).toBe(true);
});
it('keeps separate dev servers from replacing each other’s optimized dependencies',()=>{
 expect(developmentViteOptions(appRoot,7242).cacheDir).not.toBe(developmentViteOptions(appRoot,7284).cacheDir);
});
