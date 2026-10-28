import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {initSync,parse as parseImports} from 'es-module-lexer';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {libraryUrls,libraryPathForSpecifier,COMPONENTS_PATH} from './index';
import {componentFile,readComponentFile} from './components.server';
export interface RegisteredLibraryResource {url:string;contentType:'text/javascript';bytes:Uint8Array}
export interface LibraryResourceInput {url:string;contentType:string;bytes:Uint8Array}
// Same package-cwd contract as server/app.ts static serving, including bundled deployment.
const publicDir=path.resolve('public');
const registered=new Set(Object.values(libraryUrls()));
/** Public source-owned code only. No caller-selected files or network fetches. */
export async function registeredLibrarySources():Promise<Readonly<Record<string,string>>>{
 return Object.fromEntries(await Promise.all([...registered].map(async url=>{
  if(!/^\/libraries\/[a-z][a-z0-9-]*-\d+\.\d+\.\d+\/index\.js$/.test(url))throw Error('Invalid registered library path');
  return [url,await readFile(path.join(publicDir,url.slice(1)),'utf8')];
 })));
}
/** Admit only referenced pinned modules and hosted components (with the chunks they import), including references in
 * already-admitted project modules. Unused library or component bytes never consume the offline pack's limits. */
export async function referencedLibraryResources(html:string,resources:readonly LibraryResourceInput[],baseUrl:string):Promise<RegisteredLibraryResource[]>{
 initSync();const chosen=new Set<string>(),components=new Map<string,Uint8Array>(),pending:Promise<void>[]=[],origin=new URL(baseUrl).origin;
 const component=(pathname:string)=>{
  if(components.has(pathname))return;const file=componentFile(pathname.slice(COMPONENTS_PATH.length));if(!file)return;components.set(pathname,new Uint8Array());
  pending.push(readComponentFile(file).then(bytes=>{if(!bytes)throw Error('Hosted component unavailable: '+file);components.set(pathname,bytes);module(bytes.toString('utf8'),new URL(pathname,origin).href);}));
 };
 const admit=(value:string,base=baseUrl)=>{const url=new URL(libraryPathForSpecifier(value)??value,base);if(url.origin!==origin||url.search||url.username||url.password)return;if(registered.has(url.pathname))chosen.add(url.pathname);else if(url.pathname.startsWith(COMPONENTS_PATH))component(url.pathname);};
 const module=(source:string,base=baseUrl)=>{for(const item of parseImports(source)[0])if(item.n&&item.d!==-2)admit(item.n,base);};
 const visit=(node:DefaultTreeAdapterMap['node']):void=>{
  if('tagName'in node&&node.tagName==='script'){
   const src=node.attrs.find(a=>a.name==='src')?.value;
   if(src)admit(src);else if(node.attrs.some(a=>a.name==='type'&&a.value==='module'))module(node.childNodes.map(n=>'value'in n?n.value:'').join(''));
  }
  if('childNodes'in node)node.childNodes.forEach(visit);
 };visit(parse(html));
 for(const resource of resources)if(/^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/.test(resource.contentType))module(new TextDecoder().decode(resource.bytes),new URL(resource.url,baseUrl).href);
 while(pending.length)await Promise.all(pending.splice(0));
 const libraries=await Promise.all([...chosen].sort().map(async url=>({url,contentType:'text/javascript' as const,bytes:await readFile(path.join(publicDir,url.slice(1)))})));
 return [...libraries,...[...components].sort(([a],[b])=>a.localeCompare(b)).map(([url,bytes])=>({url,contentType:'text/javascript' as const,bytes}))];
}
