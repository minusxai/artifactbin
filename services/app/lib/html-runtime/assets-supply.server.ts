import type {HtmlRuntimeAssets} from './contract';
/**
 * THE RUNTIME BUILD ANOTHER PROCESS ALREADY MADE. A composition that holds this checkout's built assets names how to read
 * them, and the first buildHtmlAssets() (./build.server) reads them instead of compiling: the test suite's global setup
 * builds them once per run for every worker (services/app/test/setup/html-assets-file). A supplier that answers nothing
 * leaves the compile to buildHtmlAssets. A module of its own, apart from the build, because a production server replaces
 * that module with its prebuilt assets (scripts/build/html-core.mjs) and supplies nothing.
 */
type Supplier=()=>Promise<HtmlRuntimeAssets|undefined>;
let supplier:Supplier|undefined;
export function supplyHtmlAssets(load:Supplier|undefined):void{supplier=load;}
/** The supplied build, or undefined when none is supplied or the supplier has none. */
export async function suppliedHtmlAssets():Promise<HtmlRuntimeAssets|undefined>{return supplier?.();}
