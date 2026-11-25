/**
 * This build's runtime modules at their content addresses (`/af/v1/runtime/<sha256>/<file>`, contract
 * RUNTIME_ADDRESS_PREFIX): the sha256 of exactly the bytes the flat address (RUNTIME_MODULE_PATHS) answers. Only the
 * current build is kept; an older digest is no address here, and serving sends it to the flat module (lib/document-serving).
 */
import {createHash} from 'node:crypto';
import {buildHtmlAssets} from './build.server';
import {RUNTIME_ADDRESS_PREFIX,RUNTIME_MODULE_PATHS,type HtmlRuntimeAssets,type RuntimeModule} from './contract';

interface RuntimeAddresses {
 /** Module -> its content address, for a served page's config (`modules`). */
 modules:Record<RuntimeModule,string>;
 /** Flat file name (`reader.js`) -> its module, digest and bytes. */
 files:ReadonlyMap<string,{module:RuntimeModule;digest:string;source:string}>;
}
const computed=new WeakMap<HtmlRuntimeAssets,RuntimeAddresses>();
function addressesOf(assets:HtmlRuntimeAssets):RuntimeAddresses{
 const known=computed.get(assets);
 if(known)return known;
 const modules={} as Record<RuntimeModule,string>,files=new Map<string,{module:RuntimeModule;digest:string;source:string}>();
 for(const [key,path] of Object.entries(RUNTIME_MODULE_PATHS)){
  const module=key.slice(0,-'Path'.length) as RuntimeModule,source=assets[module];
  if(typeof source!=='string')continue;
  const file=path.slice('/af/'.length),digest=createHash('sha256').update(source).digest('hex');
  modules[module]=`${RUNTIME_ADDRESS_PREFIX}${digest}/${file}`;
  files.set(file,{module,digest,source});
 }
 const addresses={modules,files};
 computed.set(assets,addresses);
 return addresses;
}
/** Every runtime module's content address in this build. */
export async function runtimeModuleAddresses():Promise<Record<RuntimeModule,string>>{
 return addressesOf(await buildHtmlAssets()).modules;
}
/** A runtime file by name in this build: its digest and bytes, or null for a file that is no runtime module. */
export async function runtimeModuleFile(file:string):Promise<{digest:string;source:string}|null>{
 return addressesOf(await buildHtmlAssets()).files.get(file)??null;
}
