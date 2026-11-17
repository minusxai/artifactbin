/**
 * The hosted Vega-Lite compiler's one tie to Vega, read from the pinned sources without bundling: it imports exactly four
 * utilities from `vega`, and the registry aliases `vega` to the pinned `vega-util` that exports them. vega-libraries.test.ts
 * bundles both libraries and proves the compiler's bundle carries no second Vega runtime.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
const directory=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.url);
it('keeps the pinned compiler Vega import boundary to four direct utility reexports from the pinned utility package',async()=>{
 const source=await readFile(require.resolve('vega-lite'),'utf8');
 const imports=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]vega['"]/g)].flatMap(match=>match[1]!.split(',').map(binding=>binding.trim().split(/\s+as\s+/)[0]));
 expect(imports.sort()).toEqual(['hasOwnProperty','isObject','isString','stringValue']);
 const registry=JSON.parse(await readFile(path.join(directory,'registry.json'),'utf8'));
 const utility=registry['vega-lite'].aliases.vega;
 expect(utility.package).toBe('vega-util');
 const utilFile=path.resolve(path.dirname(require.resolve(utility.package)),'../package.json'); expect(JSON.parse(await readFile(utilFile,'utf8')).version).toBe(utility.version);
});
