import type {HtmlRuntimeAssets} from './contract';
/**
 * THE RUNTIME BUILD, SHARED WITH OTHER PROCESSES. A composition whose processes build the same checkout supplies where
 * the build is kept: the first buildHtmlAssets() (./build.server) reads it from there, or compiles it when there is none
 * yet and hands the result back to be kept. The test suite's workers share one per run this way
 * (services/app/test/setup/html-assets-file). A module of its own, apart from the build, because a production server
 * replaces that module with its prebuilt assets (scripts/build/html-core.mjs) and supplies nothing.
 */
export interface HtmlAssetsSupply {
 /** The kept build, or undefined when this process is to compile it. */
 read():Promise<HtmlRuntimeAssets|undefined>;
 /** This process compiled the build. */
 built(assets:HtmlRuntimeAssets):void;
 /** This process's compile failed. */
 failed():void;
}
let supply:HtmlAssetsSupply|undefined;
export function supplyHtmlAssets(next:HtmlAssetsSupply|undefined):void{supply=next;}
/** The supplied build, or `compile`'s, handed to the supply. */
export async function suppliedOrCompiled(compile:()=>Promise<HtmlRuntimeAssets>):Promise<HtmlRuntimeAssets>{
 const current=supply,kept=await current?.read();
 if(kept)return kept;
 let assets:HtmlRuntimeAssets;
 try{assets=await compile();}catch(error){current?.failed();throw error;}
 current?.built(assets);
 return assets;
}
