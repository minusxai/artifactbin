/** Fast guard for the asset naming contract, without compiling the runtime/server bundle. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {isPlatformModulePath} from '../../services/app/skills/artifactbin/scripts/preview-platform.mjs';
import {FLAT_RUNTIME_ASSET_PATH} from '../lib/runtime-asset-paths.mjs';
it('accepts every declared flat runtime path under the relocated bundle contract',()=>{
 const source=readFileSync(new URL('../../services/app/lib/html-runtime/contract.ts',import.meta.url),'utf8');
 const declaration=source.match(/export const RUNTIME_MODULE_PATHS=\{([^}]+)\}/)?.[1];
 expect(declaration).toBeTruthy();
 const paths=[...declaration.matchAll(/:'([^']+)'/g)].map(match=>match[1]);
 expect(paths.length).toBeGreaterThan(0);
 for(const path of paths){expect(path).toMatch(FLAT_RUNTIME_ASSET_PATH);expect(isPlatformModulePath(path),path).toBe(true);}
});
it.each(['/af/../escape.js','https://example.test/af/editor.js','/af/nested/editor.js','/af/editor.js?key=x','/af/editor.js#x'])('refuses non-flat runtime path %s',path=>{
 expect(path).not.toMatch(FLAT_RUNTIME_ASSET_PATH);
});
