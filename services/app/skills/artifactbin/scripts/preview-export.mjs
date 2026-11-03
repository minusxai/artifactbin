/**
 * Internal: packs a previewed page into one self-contained export. Pure local rendering boundary:
 * it never fetches, reads files, executes page scripts or accepts credentials. The preview server
 * alone admits resource bytes (through the `load` callback).
 * Used by: preview-html.mjs (re-exported, so preview-source-routes.mjs), lib/skills/
 *   preview-assets.server.ts (parser build input), preview-export and import-map tests.
 */
import {parse,serialize} from 'parse5';
import {initSync,parse as parseImports} from 'es-module-lexer';
import parseCss from 'css-tree/parser';
import walkCss from 'css-tree/walker';
initSync();
const PLATFORM=new Set(['@afbin/apollo','@afbin/reader','@afbin/chrome','@afbin/portable']);
const PREFIX='@afbin/local-export/';
const ORIGIN='http://local-export.invalid';
const JS=new Set(['text/javascript','application/javascript','application/ecmascript',
  'text/ecmascript']);
const LIMIT={files:256,fileBytes:32*1024*1024,totalBytes:128*1024*1024,htmlBytes:128*1024*1024};
const mime=value=>value.split(';')[0].trim().toLowerCase();
const data=(type,bytes)=>'data:'+type+';base64,'+Buffer.from(bytes).toString('base64');
const text=bytes=>new TextDecoder().decode(bytes);
/** See lib/skills/preview-contract.d.ts. Canonical source is never modified. */
export async function packPreviewExport({html,pathname,load,libraries={}}){
if(typeof html!=='string'||Buffer.byteLength(html)>LIMIT.htmlBytes)throw Error(
   'Local export HTML limit exceeded');
 // Intentional lazy pure dependency: downloaded parsers bundle this code; raw
 // source-checkout previews need no TypeScript loader for ordinary HTML files.
const hasEnvelope=node=>node.tagName==='script'&&node.attrs.some(attr=>attr.name==='data-af'&&
   attr.value==='portable')||(node.childNodes??[]).some(hasEnvelope);
if(hasEnvelope(parse(html))){const {recoverPortableSource}=await import(
   '../../../lib/html-runtime/portable-source.ts');html=recoverPortableSource(html);}
 const document=parse(html),resources=new Map(),modules=new Map(),styles=new Map();let total=0;
const maps=[],reserved=value=>{if(value.startsWith(PREFIX))throw Error(
   'The local export module namespace is reserved');};
const elements=[];const collect=node=>{if(node.tagName){elements.push(node);if(
   node.tagName==='template'&&node.content)collect(node.content);}for(
   const child of node.childNodes??[])collect(child);};collect(document);
for(const element of elements)if(element.tagName==='base')throw Error(
   'Local export does not support an authored base URL');
for(const element of elements)if(element.tagName==='script'&&element.attrs.some(attr=>
   attr.name==='type'&&attr.value==='importmap')){
const map=JSON.parse(element.childNodes.map(node=>node.value??'').join(''));for(
    const key of Object.keys(map.imports??{}))reserved(key);for(const scope of Object.values(
    map.scopes??{}))for(const key of Object.keys(scope))reserved(key);maps.push(map);
 }
 const resolve=(value,owner)=>{
if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0'))throw Error(
    'Invalid local export dependency');
if(/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value))throw Error(
    'Foreign resource cannot be saved locally');
const raw=decodeURIComponent(value.split(/[?#]/)[0]);if(raw.includes('\\')||raw.includes(
    '\0'))throw Error('Invalid local export dependency');
const parts=raw.startsWith('/')?[]:decodeURIComponent(new URL(owner,ORIGIN).pathname).split(
    '/').slice(1,-1);
for(const part of raw.split('/')){if(!part||part==='.')continue;if(part==='..'){if(
    !parts.length)throw Error('Dependency escapes selected project root');parts.pop();}else{if(
    part.startsWith('.'))throw Error('Hidden local export dependency refused');parts.push(part);}}
const url=new URL(value,ORIGIN+owner);if(url.origin!==ORIGIN||url.username||
    url.password)throw Error('Foreign resource cannot be saved locally');return '/'+parts.map(part=>
    encodeURIComponent(part)).join('/')+url.search+url.hash;
 };
const read=async url=>{const path=new URL(url,ORIGIN).pathname;if(resources.has(
   path))return resources.get(path);if(resources.size>=LIMIT.files)throw Error(
   'Local export file count limit exceeded');const resource=await load(path);if(!resource||!(
   resource.bytes instanceof Uint8Array)||typeof resource.contentType!=='string')throw Error(
   'Local export resource unavailable: '+path);if(resource.bytes.byteLength>LIMIT.fileBytes||(
   total+=resource.bytes.byteLength)>LIMIT.totalBytes)throw Error(
   'Local export byte limit exceeded');resources.set(path,resource);return resource;};
 const mapped=(specifier,owner)=>{
const candidates=[];for(const map of maps){for(const [scope,entries]of Object.entries(map.scopes??{
    }))if(new URL(owner,ORIGIN).href.startsWith(new URL(scope,
    ORIGIN+pathname).href))candidates.push({length:new URL(scope,ORIGIN+pathname).href.length,
    entries});candidates.push({length:-1,entries:map.imports??{}});}candidates.sort((a,b)=>
    b.length-a.length);
const normalize=(value,base)=>/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(value)?new URL(value,
    ORIGIN+base).href:value;
  const wanted=normalize(specifier,owner);
for(const {entries}of candidates){const names=Object.keys(entries).map(key=>({key,normalized:
    normalize(key,pathname)}));const exact=names.find(item=>item.normalized===wanted);if(exact){if(
    typeof entries[exact.key]!=='string')throw Error('Blocked local export module import');
    return resolve(entries[exact.key],pathname);}const prefix=names.filter(item=>
    item.normalized.endsWith('/')&&wanted.startsWith(item.normalized)).sort((a,b)=>
    b.normalized.length-a.normalized.length)[0];if(prefix){if(typeof entries[
    prefix.key]!=='string'||!entries[prefix.key].endsWith('/'))throw Error(
    'Invalid local export import map prefix');return resolve(entries[prefix.key]+wanted.slice(
    prefix.normalized.length),pathname);}}
  return null;
 };
 const rewriteModule=async(source,owner)=>{
  const edits=[];
  for(const item of parseImports(source)[0]){
if(item.d===-2)continue;if(item.n===undefined)throw Error(
     'Computed module imports cannot be saved; use literal imports');reserved(item.n);if(
     PLATFORM.has(item.n))continue;
const selected=mapped(item.n,owner)??(Object.hasOwn(libraries,item.n)?libraries[item.n]:null);if(
     !selected&&!item.n.startsWith('.')&&!item.n.startsWith('/'))throw Error(
     'Foreign or unmapped module cannot be saved locally');
const alias=await module(selected??resolve(item.n,owner));edits.push({start:item.s+(item.d>=0?1:0),
     end:item.e-(item.d>=0?1:0),value:alias});
  }
for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,
    edit.start)+edit.value+source.slice(edit.end);return source;
 };
const module=async url=>{if(modules.has(url))return modules.get(url).alias;if(
   modules.size>=LIMIT.files)throw Error('Local export module count limit exceeded');const entry={
   alias:PREFIX+modules.size,source:''};modules.set(url,entry);const resource=await read(url);if(
   !JS.has(mime(resource.contentType)))throw Error('Local module MIME is not JavaScript: '+new URL(
   url,ORIGIN).pathname);entry.source=await rewriteModule(text(resource.bytes),url);
   return entry.alias;};
const binary=async(value,owner)=>{if(/^(?:data:|#)/i.test(value))return value;const url=resolve(
   value,owner),resource=await read(url),type=mime(resource.contentType);if(
   !/^(?:image|audio|video|font)\//.test(type)&&!['application/pdf','application/octet-stream',
   'application/json','text/plain'].includes(type))throw Error(
   'Unsupported local media MIME: '+new URL(url,ORIGIN).pathname);return data(type,
   resource.bytes)+new URL(url,ORIGIN).hash;};
 const css=async(source,owner,inline=false)=>{
const edits=[];const tree=parseCss(source,{positions:true,...(inline?{context:'declarationList'}:{
    })});
walkCss(tree,function(node){if(!node.loc)return;if(node.type==='Url'){const raw=source.slice(
    node.loc.start.offset,node.loc.end.offset),prefix=/^url\(\s*["']?/i.exec(raw);if(!prefix)return;
    edits.push({start:node.loc.start.offset+prefix[0].length,end:node.loc.end.offset-(raw.match(
    /["']?\s*\)$/)?.[0].length??1),value:node.value,style:this.atrule?.name.toLowerCase(
    )==='import'});}else if(node.type==='String'&&this.atrule?.name.toLowerCase(
    )==='import')edits.push({start:node.loc.start.offset+1,end:node.loc.end.offset-1,value:
    node.value,style:true});});
for(const edit of edits.sort((a,b)=>b.start-a.start)){const value=edit.style?await stylesheet(
    edit.value,owner):await binary(edit.value,owner);source=source.slice(0,
    edit.start)+value+source.slice(edit.end);}return source;
 };
const stylesheet=async(value,owner)=>{if(/^data:/i.test(value))return value;const url=resolve(value,
   owner);if(styles.has(url)){const result=styles.get(url);if(!result)throw Error(
   'CSS dependency cycle cannot be saved');return result;}styles.set(url,null);const resource=
   await read(url);if(mime(resource.contentType)!=='text/css')throw Error(
   'Local stylesheet MIME is not CSS');const result=data('text/css',Buffer.from(await css(text(
   resource.bytes),url)));styles.set(url,result);return result;};
 for(const element of elements){
const attr=name=>element.attrs.find(attr=>attr.name===name),get=name=>attr(name)?.value,set=(name,
    value)=>{const found=attr(name);if(found)found.value=value;else element.attrs.push({name,
    value});};
  const src=get('src'),type=get('type'),platform=get('data-af');
  if(element.tagName==='script'){
if(!src&&['runtime','apollo','reader','chrome','portable-engine','portable','core'].includes(
     platform)||src==='/af/core.js'||src==='/af/v1/core.js'||type==='importmap'||type&&
     type!=='module'&&!JS.has(type))continue;
if(src){if(type==='module'){const alias=await module(resolve(src,pathname));set('src',data(
     'text/javascript',Buffer.from('import '+JSON.stringify(alias)+';')));}else{const url=resolve(
     src,pathname),resource=await read(url);if(!JS.has(mime(resource.contentType)))throw Error(
     'Local script MIME is not JavaScript');if(parseImports(text(resource.bytes))[0].some(item=>
     item.d!==-2))throw Error('Classic scripts with module dependencies cannot be saved');set('src',
     data(mime(resource.contentType),resource.bytes));}}
else if(type==='module'){const source=element.childNodes.map(node=>node.value??'').join('');
     element.childNodes=[{nodeName:'#text',value:(await rewriteModule(source,pathname)).replace(
     /<\/script/gi,'<\\/script'),parentNode:element}];}
   element.attrs=element.attrs.filter(attr=>attr.name!=='integrity');
}else if(element.tagName==='style'){element.childNodes=[{nodeName:'#text',value:await css(
    element.childNodes.map(node=>node.value??'').join(''),pathname),parentNode:element}];}
else if(element.tagName==='link'&&get('rel')==='stylesheet'&&get('href'))set('href',
    await stylesheet(get('href'),pathname));
else if(element.tagName==='link'&&(get('rel')??'').split(/\s+/).includes('icon')&&get('href'))set(
    'href',await binary(get('href'),pathname));
else if(element.tagName==='link'&&['modulepreload','preload','prefetch'].includes(get('rel'))&&get(
    'href')){if(get('rel')==='modulepreload'||get('as')==='script'){const alias=await module(
    resolve(get('href'),pathname));set('href',data('text/javascript',Buffer.from(
    'import '+JSON.stringify(alias)+';')));}else set('href',await binary(get('href'),pathname));}
  else if(element.tagName==='object'&&get('data'))set('data',await binary(get('data'),pathname));
else if(['image','use'].includes(element.tagName)&&get('href'))set('href',await binary(get('href'),
    pathname));
else if(src&&['img','source','video','audio','embed','iframe'].includes(element.tagName))set('src',
    await binary(src,pathname));
if((get('src')??get('href')??'').startsWith('data:'))element.attrs=element.attrs.filter(attr=>
    attr.name!=='integrity');
  if(get('poster'))set('poster',await binary(get('poster'),pathname));
  if(get('style'))set('style',await css(get('style'),pathname,true));
if(get('srcset')){const value=get('srcset'),entries=[];let cursor=0;while(cursor<value.length){
    while(/[\s,]/.test(value[cursor]??'')&&cursor<value.length)cursor++;const start=cursor;while(
    cursor<value.length&&!/\s/.test(value[cursor]))cursor++;const raw=value.slice(start,cursor),url=
    raw.replace(/,+$/,'');let descriptor='';if(!raw.endsWith(',')){const begin=cursor;while(
    cursor<value.length&&value[cursor]!==',')cursor++;descriptor=value.slice(begin,cursor).trim();
    }if(url)entries.push([await binary(url,pathname),descriptor].filter(Boolean).join(' '));}set(
    'srcset',entries.join(', '));}
 }
if(modules.size){const imports=Object.fromEntries([...modules.values()].map(entry=>[entry.alias,
   data('text/javascript',Buffer.from(entry.source))+'#'+encodeURIComponent(entry.alias)]));
   const fragment=parse('<script type="importmap">'+JSON.stringify({imports}).replace(/</g,
   '\\u003c')+'</script>');const head=document.childNodes.find(node=>
   node.tagName==='html').childNodes.find(node=>node.tagName==='head');const script=
   fragment.childNodes.find(node=>node.tagName==='html').childNodes.find(node=>
   node.tagName==='head').childNodes[0];script.parentNode=head;head.childNodes.unshift(script);}
const output=serialize(document);if(Buffer.byteLength(output)>LIMIT.htmlBytes)throw Error(
   'Local export HTML limit exceeded');return output;
}
