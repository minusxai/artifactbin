import { escapeSourceAttribute } from '@artifactbin/utils/escape';
import {libraryPathForSpecifier} from '../libraries';
import path from 'node:path';
import {admitRuntimeModuleImports} from './runtime-module-imports';
import {fileContentType} from '@artifactbin/contracts';
import {initSync,parse as parseImports} from 'es-module-lexer';
import {parseCss,walkCss} from './css';
import {scriptFetchPaths} from '../html-autofix';
initSync();
import {parse, type DefaultTreeAdapterMap} from 'parse5';
import type {PublicationBundle,BundlePlan,BundleDependency,BundleResolutionContext,AuthoringHtmlOptions} from './contracts';
export type {PublicationBundle,BundlePlan} from './contracts';
const MAX_FILES=99,MAX_BYTES=16_000_000,MAX_FILE=4_000_000;
/** `hyperlink`: an `<a>`/`<area>` href. It names a project file only when it has a path; one that names none is navigation. */
interface Link {start:number;end:number;value:string;kind:'asset'|'dataset';htmlAttribute?:true;runtimeModule?:true;hyperlink?:true}
/** A hyperlink to the page itself or nowhere: an empty href, a query or hash alone, `.`, `./`. */
const SELF_LINK=/^\s*(?:\.\/?)?\s*(?:[?#]|$)/;
function normalized(value:string):string{
 if(!value||value.includes('\\')||value.includes('\0')||value.startsWith('/')||value.split('/').includes('..'))throw Error('Invalid bundle path: '+value);
 const result=path.posix.normalize(value);if(result==='.'||result.startsWith('../'))throw Error('Invalid bundle path: '+value);return result;
}
function resolve(value:string,owner:string):string|null{
 if(!value||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value))return null;
 let decoded:string;try{decoded=decodeURIComponent(value.split(/[?#]/)[0]!);}catch{throw Error('Invalid dependency URL');}
 const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(owner),decoded));return normalized(resolved);
}
/**
 * Root-relative paths a page may load where it is served (its own origin's static directories, its doors, other
 * artifacts' bytes): anything else root-relative names nothing there, since a page's address differs by where it is read.
 */
const PLATFORM_PATH=/^\/(?:af|fonts|libraries|geojson|basemap|islands|a|fn|api\/users)\/|^\/favicon\.ico(?:[?#]|$)/;
/** The project path a root-relative `/x/y.css` names (the bundle's root is the project's), or null when it names none. */
function rootedPath(value:string):string|null{
 let decoded:string;try{decoded=decodeURIComponent(value.split(/[?#]/)[0]!).slice(1);}catch{return null;}
 try{return normalized(path.posix.normalize(decoded));}catch{return null;}
}
function links(source:string,css:boolean,js=false):Link[]{
 if(js){const imports=parseImports(source)[0],runtime=imports.some(item=>item.n===undefined&&item.d!==-2)?admitRuntimeModuleImports(source):[];return imports.flatMap(item=>{
  if(item.d===-2)return [];
  if(item.n==='@afbin/apollo'||item.n==='@afbin/reader'||item.n==='@afbin/chrome'||item.n==='@afbin/portable'||item.n==='@afbin/collab'||item.n==='@afbin/state')return [];
  if(item.n!==undefined&&libraryPathForSpecifier(item.n))return [];
  if(item.n===undefined){const admitted=runtime.find(entry=>entry.importStart===item.ss);if(!admitted)throw Error('Computed module imports require an explicit absolute remote URL');return [{start:admitted.argumentStart,end:admitted.argumentEnd,value:admitted.replacement,kind:'asset' as const,runtimeModule:true as const}];}
  if(!item.n.startsWith('.')&&!item.n.startsWith('/')&&!/^[a-z][a-z\d+.-]*:/i.test(item.n))throw Error('Bare module imports require an import map or absolute remote URL');
  return [{start:item.s+(item.d>=0?1:0),end:item.e-(item.d>=0?1:0),value:item.n,kind:'asset' as const}];
 });}
 if(css){
  const result:Link[]=[];
  let tree;try{tree=parseCss(source,{positions:true});}catch{tree=parseCss(source,{positions:true,context:'declarationList'});}
  walkCss(tree,function(node){
   if(!node.loc)return;
   if(node.type==='Url'){
    const raw=source.slice(node.loc.start.offset,node.loc.end.offset);
    const prefix=/^url\(\s*["']?/i.exec(raw);if(!prefix)throw Error('Unsupported CSS URL');
    const start=node.loc.start.offset+prefix[0].length;
    const end=node.loc.end.offset-(raw.match(/["']?\s*\)$/)?.[0].length??1);
    result.push({start,end,value:node.value,kind:'asset'});
   }else if(node.type==='String'&&this.atrule?.name.toLowerCase()==='import')result.push({start:node.loc.start.offset+1,end:node.loc.end.offset-1,value:node.value,kind:'asset'});
  });return result;
 }
 const result:Link[]=[];const doc=parse(source,{sourceCodeLocationInfo:true});
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('tagName'in node){
   const dataset=node.tagName==='link'&&node.attrs.some(a=>a.name==='rel'&&a.value.split(/\s+/).includes('af-dataset'));
   const location=node.sourceCodeLocation;
   if((node.tagName==='style'||node.tagName==='script'&&node.attrs.some(a=>a.name==='type'&&a.value==='module'))&&location?.startTag&&location.endTag){
    const start=location.startTag.endOffset;
    for(const link of links(source.slice(start,location.endTag.startOffset),node.tagName==='style',node.tagName==='script'))result.push({...link,start:link.start+start,end:link.end+start});
   }
   for(const attr of node.attrs){
    if(!['src','href','poster','data','srcset','style'].includes(attr.name))continue;
    if(attr.name==='data'&&node.tagName!=='object')continue;
    // Literal authored image bindings are retained; they are not project filenames.
    if(node.tagName==='img'&&attr.name==='src'&&/^\$[_A-Za-z][_0-9A-Za-z]*$|^\{\$[_A-Za-z][_0-9A-Za-z]*\}$/.test(attr.value))continue;
    // A link (`<a>`, `<area>`) to a project file publishes that file with the page, as an `<img>` does: a relative
    // address on the page's own origin names nothing a reader can open. Remote, root-relative and in-page links stay.
    const hyperlink=attr.name==='href'&&(node.tagName==='a'||node.tagName==='area');
    if(attr.name==='href'&&!hyperlink&&!['link','image','use'].includes(node.tagName))continue;
    if(hyperlink&&SELF_LINK.test(attr.value))continue;
    const loc=node.sourceCodeLocation?.attrs?.[attr.name];if(!loc)continue;
    const written=source.slice(loc.startOffset,loc.endOffset),equals=written.indexOf('=');if(equals<0)continue;
    const raw=written.slice(equals+1),leading=raw.search(/\S/),quote=raw[leading];const start=loc.startOffset+equals+1+leading+(quote==='"'||quote==="'"?1:0);
    const end=quote==='"'||quote==="'"?source.indexOf(quote,start):loc.endOffset;
    if(attr.name==='style'){
     for(const link of links(source.slice(start,end),true))result.push({...link,start:start+link.start,end:start+link.end,htmlAttribute:true});
    }else if(attr.name==='srcset'){
     const value=source.slice(start,end);let cursor=0;
     while(cursor<value.length){
      while(/[\s,]/.test(value[cursor]??'')&&cursor<value.length)cursor++;
      const begin=cursor;while(cursor<value.length&&!/\s/.test(value[cursor]!))cursor++;
      let stop=cursor;while(value[stop-1]===',')stop--;
      if(stop>begin)result.push({start:start+begin,end:start+stop,value:value.slice(begin,stop),kind:'asset',htmlAttribute:true});
      if(stop<cursor)continue;
      while(cursor<value.length&&value[cursor]!==',')cursor++;
     }
    }else result.push({start,end,value:attr.value,kind:dataset?'dataset':'asset',htmlAttribute:true,...(hyperlink?{hyperlink:true as const}:{})});
   }
   if(node.tagName==='template'&&'content'in node)for(const child of node.content.childNodes)visit(child);
  }
  if('childNodes'in node)for(const child of node.childNodes)visit(child);
 };visit(doc);return result;
}
/** What a script fetches by a literal path (lib/html-autofix scriptFetchPaths): the page's inline scripts, or a module file. */
const JS_TYPES=new Set(['','module','text/javascript','application/javascript']);
function fetchedPaths(source:string,page:boolean):string[]{
 if(!page)return scriptFetchPaths(source);
 const found:string[]=[];
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('tagName'in node&&node.tagName==='script'&&!node.attrs.some(a=>a.name==='src')){
   const type=node.attrs.find(a=>a.name==='type')?.value.trim().toLowerCase()??'';
   if(JS_TYPES.has(type))found.push(...scriptFetchPaths(node.childNodes.map(child=>'value'in child?child.value:'').join(''),type==='module'));
  }
  if('tagName'in node&&node.tagName==='template'&&'content'in node)for(const child of node.content.childNodes)visit(child);
  if('childNodes'in node)for(const child of node.childNodes)visit(child);
 };visit(parse(source));return found;
}
export function planPublicationBundle(html:string,bundle:PublicationBundle,context:BundleResolutionContext={}):BundlePlan{
 if(!bundle||typeof bundle.entryPath!=='string'||!Array.isArray(bundle.files)||bundle.files.length>MAX_FILES)throw Error('Invalid publication bundle');
 if(html.length>4_000_000||JSON.stringify(bundle).length>24_000_000||Object.keys(bundle.mappings??{}).length>99)throw Error('Publication bundle limit exceeded');
 for(const name of Object.keys(bundle.mappings??{}))if(normalized(name)!==name)throw Error('Noncanonical mapping path');
 const entryPath=normalized(bundle.entryPath),files=new Map<string,{bytes:Buffer;contentType:string}>();let total=0;
 for(const file of bundle.files){
  const name=normalized(file.path);if(files.has(name))throw Error('Duplicate bundle path: '+name);
  // A repeated captured quartet over multi-megabyte assets overflows the regex VM stack.
  // Check the alphabet/padding linearly; the decode/re-encode below enforces canonical bits.
  if(typeof file.base64!=='string'||file.base64.length>Math.ceil(MAX_FILE/3)*4||file.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))throw Error('Invalid bundle base64');
  const bytes=Buffer.from(file.base64,'base64');if(bytes.toString('base64')!==file.base64||bytes.length>MAX_FILE||(total+=bytes.length)>MAX_BYTES)throw Error('Bundle byte limit exceeded');
  if(typeof file.contentType!=='string'||file.contentType.length>128)throw Error('Invalid bundle content type');files.set(name,{bytes,contentType:fileContentType(name)??file.contentType});
 }
 const ordered:BundleDependency[]=[],visiting=new Set<string>(),visited=new Map<string,'asset'|'dataset'>(),missing=new Set<string>();
 const dependencies=(source:string,owner:string,css=false)=>links(source,css,/^(?:text|application)\/javascript$/.test(files.get(owner)?.contentType??'')).flatMap(link=>{
  if(link.runtimeModule)return [];
  // A root-relative reference (`/assets/fonts/x.woff2`) to a file published with the page is that file; one to none is
  // refused unless it is the platform's own (a link to none is navigation, and a bare save keeps everything as written).
  if(/^\/(?!\/)/.test(link.value)){
   const rooted=rootedPath(link.value);
   if(rooted&&(files.has(rooted)||bundle.mappings?.[rooted]))return [{...link,path:rooted}];
   if(!rooted||link.hyperlink||context.linksAsWritten||PLATFORM_PATH.test(link.value))return [];
   let relative=path.posix.relative(path.posix.dirname(owner),rooted);if(!relative.startsWith('.'))relative='./'+relative;
   throw Error(`${link.value.split(/[?#]/)[0]} (in ${owner}) names no file published with the page, so it loads nothing where the page is read: put the file in the project and write it relative to ${owner} (${relative}), or use a full https address`);
  }
  let name:string|null;
  // A bare save keeps any link as written, including one that leaves the project (`../`).
  try{name=resolve(link.value,owner);}catch(error){if(link.hyperlink&&context.linksAsWritten)return [];throw error;}
  return name?[{...link,path:name}]:[];
 });
 const visit=(name:string,kind:'asset'|'dataset',hyperlink=false)=>{
  if(visiting.has(name))throw Error('Dependency cycle: '+name);
  if(visited.has(name)){if(visited.get(name)!==kind)throw Error('Conflicting dependency kind: '+name);return;}
  const file=files.get(name);if(!file){if(!bundle.mappings?.[name]&&!(hyperlink&&context.linksAsWritten))missing.add(name);return;}
  visiting.add(name);const nested=/^(?:text\/css|(?:text|application)\/javascript)$/.test(file.contentType)?dependencies(file.bytes.toString('utf8'),name,file.contentType==='text/css'):[];
  if(/^(?:text|application)\/javascript$/.test(file.contentType))fetched.push(...fetchedPaths(file.bytes.toString('utf8'),false));
  for(const dep of nested)visit(dep.path,dep.kind);
  visiting.delete(name);visited.set(name,kind);ordered.push({path:name,kind,contentType:file.contentType,bytes:file.bytes,dependencies:nested.map(d=>d.path)});
 };
 // A literal fetch is never rewritten: the page's core maps the path it names to the published file wherever the page
 // is read (html-runtime page-fetch, the runtime config's `files`). It resolves against the page, from any file; a path
 // the project does not hold, or that leaves it, names no file of it and stays the script's own.
 const fetched:string[]=fetchedPaths(html,true);
 for(const dep of dependencies(html,entryPath))visit(dep.path,dep.kind,dep.hyperlink);
 for(let at=0;at<fetched.length;at++){
  let name:string|null;try{name=resolve(fetched[at]!,entryPath);}catch{continue;}
  if(name&&name!==entryPath&&!visited.has(name)&&(files.has(name)||bundle.mappings?.[name]))visit(name,'asset');
 }
 if(missing.size)throw Error('Unresolved local dependencies: '+[...missing].sort().join(', '));
 // Every published file is one the page links or a script fetches by its path: nothing else reaches it.
 const unlinked=[...files.keys()].filter(name=>name!==entryPath&&!visited.has(name)).sort();
 if(unlinked.length){
  let first=path.posix.relative(path.posix.dirname(entryPath),unlinked[0]!);if(!first.startsWith('.'))first='./'+first;
  throw Error(`Not linked from the page: ${unlinked.join(', ')}: a file publishes with its page when the page links it (<a href="${first}">) or a script fetches it by that literal path (fetch('${first}'))`);
 }
 return {html,entryPath,dependencies:ordered,rewrite(source,owner,addresses){
  const css=files.get(owner)?.contentType==='text/css',js=/^(?:text|application)\/javascript$/.test(files.get(owner)?.contentType??'');const guards=links(source,css,js).filter(link=>link.runtimeModule);const edits=[...dependencies(source,owner,css),...guards.map(link=>({...link,path:''}))];let result=source;
  for(const edit of edits.sort((a,b)=>b.start-a.start)){if(edit.runtimeModule){result=result.slice(0,edit.start)+edit.value+result.slice(edit.end);continue;}const address=addresses.get(edit.path);if(!address){if(edit.hyperlink&&context.linksAsWritten)continue;throw Error('Unresolved local dependency: '+edit.path);}const suffix=edit.kind==='asset'?(edit.value.match(/[?#].*$/)?.[0]??''):'';const target=address+(suffix.startsWith('?')&&address.includes('?')?'&'+suffix.slice(1):suffix);const escaped=edit.htmlAttribute?escapeSourceAttribute(target):target;result=result.slice(0,edit.start)+escaped+result.slice(edit.end);}return result;
 }};
}
/** Read-only preview: the final publication repeats this validation before reserving IDs. */
export function inspectPublicationBundle(html:string,bundle:PublicationBundle,context:BundleResolutionContext={}){
 const plan=planPublicationBundle(html,bundle,context);
 return {entryPath:plan.entryPath,dependencies:plan.dependencies.map(({path,kind,contentType,bytes,dependencies})=>({path,kind,contentType,bytes:bytes.byteLength,dependencies})),reusedPaths:Object.keys(bundle.mappings??{}),limits:{files:99,fileBytes:4_000_000,totalBytes:16_000_000}};
}
/** Pin hosted dependency reads to the immutable parent version, including nested stylesheet/module URLs. `captureKey`: an
 * export capture's verified key (lib/export read-key), set on each own-door address so the capture's next request is
 * admitted too; given only when serving that capture its own bytes, never for anything stored or kept. */
export function pinPublicationAssetUrls(source:string,pageId:string,version:number,contentType='text/html',admittedAssets:readonly {id:string;revision:string}[]=[],captureKey:string|null=null):string{
 const matches=links(source,contentType==='text/css',/^(?:text|application)\/javascript$/.test(contentType));let result=source;
 for(const link of matches.sort((a,b)=>b.start-a.start)){
  if(!/^\/a\/[A-Za-z0-9]+\/assets\?/.test(link.value))continue;
  const url=new URL(link.value,'https://bundle.invalid');
  if(url.searchParams.getAll('dependency').length!==1)continue;
  if(url.pathname!==`/a/${pageId}/assets`){
   if(url.searchParams.getAll('revision').length!==1||!admittedAssets.some(asset=>asset.id===url.searchParams.get('dependency')&&asset.revision===url.searchParams.get('revision')))continue;
   url.pathname=`/a/${pageId}/assets`;
  }
  url.searchParams.set('version',String(version));
  if(captureKey)url.searchParams.set('key',captureKey);
  const address=url.pathname+url.search+url.hash;
  const escaped=link.htmlAttribute?escapeSourceAttribute(address):address;
  result=result.slice(0,link.start)+escaped+result.slice(link.end);
 }
 return result;
}

/** Produce local authoring references from a canonical saved page, never from a rendered/exported wrapper. */
export function authoringHtml(html:string,options:AuthoringHtmlOptions):string{
 const origin=new URL(options.server).origin;
 const receipts=new Map(options.receipts.map(receipt=>[receipt.id,receipt]));
 const edits=links(html,false).flatMap(link=>{
  let receipt;let suffix='';
  if(link.value.startsWith('ref:'))receipt=receipts.get(link.value.slice(4));
  else try{
   const url=new URL(link.value,origin);
   if(url.origin!==origin||url.pathname!==`/a/${options.pageId}/assets`)return [];
   receipt=receipts.get(url.searchParams.get('dependency')??'');
   if(!receipt||receipt.revision!==url.searchParams.get('revision'))return [];
   url.searchParams.delete('dependency');url.searchParams.delete('revision');url.searchParams.delete('version');
   suffix=(url.searchParams.size?'?'+url.searchParams.toString():'')+url.hash;
  }catch{return [];}
  if(!receipt)return [];
  normalized(receipt.path);
  let value=path.posix.relative(path.posix.dirname(options.entryPath),receipt.path);if(!value.startsWith('.'))value='./'+value;
  value+=suffix;
  if(link.htmlAttribute)value=escapeSourceAttribute(value).replaceAll("'",'&#39;');
  return [{start:link.start,end:link.end,value}];
 });
 let result=html;for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.value+result.slice(edit.end);
 return result;
}
