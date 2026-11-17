/**
 * A supplied runtime build (./assets-supply.server): the first buildHtmlAssets() reads the kept build and compiles
 * nothing; with none kept it compiles and hands the build to the supply, or tells it the compile failed.
 */
import {beforeEach,expect,it,vi} from 'vitest';
const bundles=vi.hoisted(()=>({count:0,fail:false}));
vi.mock('esbuild',()=>({build:async()=>{bundles.count++;if(bundles.fail)throw new Error('bundle broke');return {outputFiles:[{text:'compiled'}]};}}));
vi.mock('../build-portable-chrome.server',()=>({buildPortableChrome:async()=>'chrome',buildHostComments:async()=>'comments'}));
beforeEach(()=>{vi.resetModules();bundles.count=0;bundles.fail=false;});
async function fresh(){
 const [{buildHtmlAssets},{supplyHtmlAssets}]=await Promise.all([import('../build.server'),import('../assets-supply.server')]);
 return {buildHtmlAssets,supplyHtmlAssets};
}
const kept={core:'kept core',apollo:'kept apollo',apolloPath:'/af/apollo.js',reader:'kept reader',readerPath:'/af/reader.js'};
const supply=(read:()=>Promise<typeof kept|undefined>)=>({read:vi.fn(read),built:vi.fn(),failed:vi.fn()});

it('reads a kept build instead of compiling, once per process',async()=>{
 const {buildHtmlAssets,supplyHtmlAssets}=await fresh();
 const kept_=supply(async()=>kept);
 supplyHtmlAssets(kept_);
 expect(await buildHtmlAssets()).toBe(kept);
 expect(await buildHtmlAssets()).toBe(kept);
 expect(kept_.read).toHaveBeenCalledTimes(1);
 expect(kept_.built).not.toHaveBeenCalled();
 expect(bundles.count).toBe(0);
});

it('compiles when none is kept and hands the build to the supply, as it compiles when nothing is supplied',async()=>{
 const {buildHtmlAssets,supplyHtmlAssets}=await fresh();
 const empty=supply(async()=>undefined);
 supplyHtmlAssets(empty);
 const assets=await buildHtmlAssets();
 expect(assets.hostComments).toBe('comments');
 expect(bundles.count).toBeGreaterThan(0);
 expect(empty.built).toHaveBeenCalledWith(assets);
 vi.resetModules();bundles.count=0;
 expect((await (await fresh()).buildHtmlAssets()).core).toContain('compiled');
 expect(bundles.count).toBeGreaterThan(0);
});

it('tells the supply a compile failed, and compiles again on the next call',async()=>{
 const {buildHtmlAssets,supplyHtmlAssets}=await fresh();
 const empty=supply(async()=>undefined);
 supplyHtmlAssets(empty);
 bundles.fail=true;
 await expect(buildHtmlAssets()).rejects.toThrow('bundle broke');
 expect(empty.failed).toHaveBeenCalledTimes(1);
 expect(empty.built).not.toHaveBeenCalled();
 bundles.fail=false;
 expect((await buildHtmlAssets()).core).toContain('compiled');
 expect(empty.built).toHaveBeenCalledTimes(1);
});
