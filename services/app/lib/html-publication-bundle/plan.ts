import path from 'node:path';
import {fileContentType} from '@artifactbin/contracts';
import {initSync,parse as parseImports} from 'es-module-lexer';
import parseCss from 'css-tree/parser';
import walkCss from 'css-tree/walker';
initSync();
import {parse, type DefaultTreeAdapterMap} from 'parse5';
import type {PublicationBundle,BundlePlan,BundleDependency} from './contracts';
export type {PublicationBundle,BundlePlan} from './contracts';
const MAX_FILES=99,MAX_BYTES=16_000_000,MAX_FILE=4_000_000;
interface Link {start:number;end:number;value:string;kind:'asset'|'dataset'}
function normalized(value:string):string{
 if(!value||value.includes('\\')||value.includes('\0')||value.startsWith('/')||value.split('/').includes('..'))throw Error('Invalid bundle path: '+value);
 const result=path.posix.normalize(value);if(result==='.'||result.startsWith('../'))throw Error('Invalid bundle path: '+value);return result;
}
function resolve(value:string,owner:string):string|null{
 if(!value||/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(value))return null;
 let decoded:string;try{decoded=decodeURIComponent(value.split(/[?#]/)[0]!);}catch{throw Error('Invalid dependency URL');}
 const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(owner),decoded));return normalized(resolved);
}
function links(source:string,css:boolean,js=false):Link[]{
 if(js)return parseImports(source)[0].flatMap(item=>{
  if(item.d===-2)return [];
  if(item.n==='@afbin/apollo'||item.n==='@afbin/reader'||item.n==='@afbin/chrome')return [];
  if(item.n===undefined)throw Error('Computed module imports require an explicit absolute remote URL');
  if(!item.n.startsWith('.')&&!item.n.startsWith('/')&&!/^[a-z][a-z\d+.-]*:/i.test(item.n))throw Error('Bare module imports require an import map or absolute remote URL');
  return [{start:item.s+(item.d>=0?1:0),end:item.e-(item.d>=0?1:0),value:item.n,kind:'asset' as const}];
 });
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
    // Hyperlinks are navigation, not uploaded content. Core and absolute API paths remain server-owned.
    if(attr.name==='href'&&!['link','image','use'].includes(node.tagName))continue;
    const loc=node.sourceCodeLocation?.attrs?.[attr.name];if(!loc)continue;
    const written=source.slice(loc.startOffset,loc.endOffset),equals=written.indexOf('=');if(equals<0)continue;
    const raw=written.slice(equals+1),leading=raw.search(/\S/),quote=raw[leading];const start=loc.startOffset+equals+1+leading+(quote==='"'||quote==="'"?1:0);
    const end=quote==='"'||quote==="'"?source.indexOf(quote,start):loc.endOffset;
    if(attr.name==='style'){
     for(const link of links(source.slice(start,end),true))result.push({...link,start:start+link.start,end:start+link.end});
    }else if(attr.name==='srcset'){
     const value=source.slice(start,end);let cursor=0;
     while(cursor<value.length){
      while(/[\s,]/.test(value[cursor]??'')&&cursor<value.length)cursor++;
      const begin=cursor;while(cursor<value.length&&!/\s/.test(value[cursor]!))cursor++;
      let stop=cursor;while(value[stop-1]===',')stop--;
      if(stop>begin)result.push({start:start+begin,end:start+stop,value:value.slice(begin,stop),kind:'asset'});
      if(stop<cursor)continue;
      while(cursor<value.length&&value[cursor]!==',')cursor++;
     }
    }else result.push({start,end,value:attr.value,kind:dataset?'dataset':'asset'});
   }
   if(node.tagName==='template'&&'content'in node)for(const child of node.content.childNodes)visit(child);
  }
  if('childNodes'in node)for(const child of node.childNodes)visit(child);
 };visit(doc);return result;
}
export function planPublicationBundle(html:string,bundle:PublicationBundle):BundlePlan{
 if(!bundle||typeof bundle.entryPath!=='string'||!Array.isArray(bundle.files)||bundle.files.length>MAX_FILES)throw Error('Invalid publication bundle');
 if(html.length>4_000_000||JSON.stringify(bundle).length>24_000_000||Object.keys(bundle.mappings??{}).length>99)throw Error('Publication bundle limit exceeded');
 for(const name of Object.keys(bundle.mappings??{}))if(normalized(name)!==name)throw Error('Noncanonical mapping path');
 const entryPath=normalized(bundle.entryPath),files=new Map<string,{bytes:Buffer;contentType:string}>();let total=0;
 for(const file of bundle.files){
  const name=normalized(file.path);if(files.has(name))throw Error('Duplicate bundle path: '+name);
  if(typeof file.base64!=='string'||file.base64.length>Math.ceil(MAX_FILE/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))throw Error('Invalid bundle base64');
  const bytes=Buffer.from(file.base64,'base64');if(bytes.toString('base64')!==file.base64||bytes.length>MAX_FILE||(total+=bytes.length)>MAX_BYTES)throw Error('Bundle byte limit exceeded');
  if(typeof file.contentType!=='string'||file.contentType.length>128)throw Error('Invalid bundle content type');files.set(name,{bytes,contentType:fileContentType(name)??file.contentType});
 }
 const backendSources:Record<string,string>={},backends:Array<{name:string;path:string;bytes:number}>=[],backendPaths=new Set<string>(),backendEdits:Array<{start:number;end:number}>=[];
 const backendDocument=parse(html,{sourceCodeLocationInfo:true});
 const findBackends=(node:DefaultTreeAdapterMap['node']):void=>{
  if('tagName'in node&&node.tagName==='link'&&node.attrs.some(attr=>attr.name==='rel'&&attr.value.split(/\s+/).includes('af-backend'))){
   const href=node.attrs.find(attr=>attr.name==='href')?.value,name=node.attrs.find(attr=>attr.name==='data-af-name')?.value;
   const local=href&&resolve(href,entryPath);
   if(local){
    if(!name||!/^[_A-Za-z][_0-9A-Za-z]*$/.test(name)||backendSources[name]!==undefined)throw Error('Invalid or duplicate backend namespace');
    const file=files.get(local);if(!file)throw Error('Unresolved local dependencies: '+local);
    backendSources[name]=file.bytes.toString('utf8');backends.push({name,path:local,bytes:file.bytes.byteLength});backendPaths.add(local);
    const location=node.sourceCodeLocation?.attrs?.href;if(location)backendEdits.push({start:location.startOffset,end:location.endOffset});
   }
  }
  if('childNodes'in node)for(const child of node.childNodes)findBackends(child);
 };findBackends(backendDocument);
 for(const edit of backendEdits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+html.slice(edit.end);
 const ordered:BundleDependency[]=[],visiting=new Set<string>(),visited=new Map<string,'asset'|'dataset'>(),missing=new Set<string>();
 const dependencies=(source:string,owner:string,css=false)=>links(source,css,/^(?:text|application)\/javascript$/.test(files.get(owner)?.contentType??'')).flatMap(link=>{const name=resolve(link.value,owner);return name?[{...link,path:name}]:[];});
 const visit=(name:string,kind:'asset'|'dataset')=>{
  if(backendPaths.has(name))throw Error('Backend files cannot also be uploaded assets: '+name);
  if(visiting.has(name))throw Error('Dependency cycle: '+name);
  if(visited.has(name)){if(visited.get(name)!==kind)throw Error('Conflicting dependency kind: '+name);return;}
  const file=files.get(name);if(!file){if(!bundle.mappings?.[name])missing.add(name);return;}
  visiting.add(name);const nested=/^(?:text\/css|(?:text|application)\/javascript)$/.test(file.contentType)?dependencies(file.bytes.toString('utf8'),name,file.contentType==='text/css'):[];
  for(const dep of nested)visit(dep.path,dep.kind);
  visiting.delete(name);visited.set(name,kind);ordered.push({path:name,kind,contentType:file.contentType,bytes:file.bytes,dependencies:nested.map(d=>d.path)});
 };
 for(const dep of dependencies(html,entryPath))visit(dep.path,dep.kind);
 // Explicit manifest entries also admit dependencies used dynamically by scripts.
 for(const name of files.keys())if(name!==entryPath&&!backendPaths.has(name)&&!visited.has(name))visit(name,'asset');
 if(missing.size)throw Error('Unresolved local dependencies: '+[...missing].sort().join(', '));
 return {backendSources,backends,html,entryPath,dependencies:ordered,rewrite(source,owner,addresses){
  const edits=dependencies(source,owner,files.get(owner)?.contentType==='text/css');let result=source;
  for(const edit of edits.sort((a,b)=>b.start-a.start)){const address=addresses.get(edit.path);if(!address)throw Error('Unresolved local dependency: '+edit.path);const suffix=edit.kind==='asset'?(edit.value.match(/[?#].*$/)?.[0]??''):'';const target=address+(suffix.startsWith('?')&&address.includes('?')?'&'+suffix.slice(1):suffix);const escaped=owner===entryPath?target.replaceAll('&','&amp;').replaceAll('"','&quot;'):target;result=result.slice(0,edit.start)+escaped+result.slice(edit.end);}return result;
 }};
}
/** Read-only preview: the final publication repeats this validation before reserving IDs. */
export function inspectPublicationBundle(html:string,bundle:PublicationBundle){
 const plan=planPublicationBundle(html,bundle);
 return {entryPath:plan.entryPath,backends:plan.backends,dependencies:plan.dependencies.map(({path,kind,contentType,bytes,dependencies})=>({path,kind,contentType,bytes:bytes.byteLength,dependencies})),reusedPaths:Object.keys(bundle.mappings??{}),limits:{files:99,fileBytes:4_000_000,totalBytes:16_000_000}};
}
/** Pin hosted dependency reads to the immutable parent version, including nested stylesheet/module URLs. */
export function pinPublicationAssetUrls(source:string,pageId:string,version:number,contentType='text/html'):string{
 const matches=links(source,contentType==='text/css',/^(?:text|application)\/javascript$/.test(contentType));let result=source;
 for(const link of matches.sort((a,b)=>b.start-a.start)){
  if(!link.value.startsWith(`/a/${pageId}/assets?`))continue;
  const url=new URL(link.value,'https://bundle.invalid');
  if(url.pathname!==`/a/${pageId}/assets`||url.searchParams.getAll('dependency').length!==1)continue;
  url.searchParams.set('version',String(version));
  const address=url.pathname+url.search+url.hash;
  const escaped=contentType==='text/html'?address.replaceAll('&','&amp;').replaceAll('"','&quot;'):address;
  result=result.slice(0,link.start)+escaped+result.slice(link.end);
 }
 return result;
}
