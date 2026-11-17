/**
 * A supplied runtime build (./assets-supply.server): the first buildHtmlAssets() reads it and compiles nothing; a
 * supplier that answers nothing leaves the compile to buildHtmlAssets, as when none is supplied.
 */
import {beforeEach,expect,it,vi} from 'vitest';
const bundles=vi.hoisted(()=>({count:0}));
vi.mock('esbuild',()=>({build:async()=>{bundles.count++;return {outputFiles:[{text:'compiled'}]};}}));
vi.mock('../build-portable-chrome.server',()=>({buildPortableChrome:async()=>'chrome',buildHostComments:async()=>'comments'}));
beforeEach(()=>{vi.resetModules();bundles.count=0;});
async function fresh(){
 const [{buildHtmlAssets},{supplyHtmlAssets}]=await Promise.all([import('../build.server'),import('../assets-supply.server')]);
 return {buildHtmlAssets,supplyHtmlAssets};
}
const built={core:'supplied core',apollo:'supplied apollo',apolloPath:'/af/apollo.js',reader:'supplied reader',readerPath:'/af/reader.js'};

it('reads a supplied build instead of compiling, once per process',async()=>{
 const {buildHtmlAssets,supplyHtmlAssets}=await fresh();
 const supplier=vi.fn(async()=>built);
 supplyHtmlAssets(supplier);
 expect(await buildHtmlAssets()).toBe(built);
 expect(await buildHtmlAssets()).toBe(built);
 expect(supplier).toHaveBeenCalledTimes(1);
 expect(bundles.count).toBe(0);
});

it('compiles when the supplier has no build, as when nothing is supplied',async()=>{
 const {buildHtmlAssets,supplyHtmlAssets}=await fresh();
 supplyHtmlAssets(async()=>undefined);
 expect((await buildHtmlAssets()).hostComments).toBe('comments');
 expect(bundles.count).toBeGreaterThan(0);
 vi.resetModules();bundles.count=0;
 const unsupplied=await fresh();
 expect((await unsupplied.buildHtmlAssets()).core).toContain('compiled');
 expect(bundles.count).toBeGreaterThan(0);
});
