import {parse as parseJavaScript} from 'acorn';
import {build,type Loader} from 'esbuild';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import type {OfflineDependencyInput,OfflineDependencyResult} from './contracts';
export type {OfflineDependencyInput,OfflineDependencyResult} from './contracts';
const JS=new Set(['application/javascript','text/javascript','application/ecmascript','text/ecmascript']);
const type=(mime:string)=>mime.split(';')[0]!.trim().toLowerCase();
const encoded=(mime:string,bytes:Uint8Array)=>`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const escaped=(value:string)=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
/** Pure byte transformation: all IO and authorization happen before this boundary. */
export async function packOfflineDependencies(input:OfflineDependencyInput):Promise<OfflineDependencyResult>{
 const canonical=(value:string,base=input.baseUrl)=>{const url=new URL(value,base);if(url.username||url.password||[...url.searchParams.keys()].some(key=>/^(?:token|key|authorization|access_token|_pt)$/i.test(key)))throw Error('Offline resource URL contains credentials');if(!['https:','http:'].includes(url.protocol))throw Error('Unsupported offline resource URL');url.hash='';return url.href;};
 const resources=new Map<string,{contentType:string;bytes:Uint8Array}>();
 for(const resource of input.resources){const url=canonical(resource.url),previous=resources.get(url);if(previous&&(previous.contentType!==resource.contentType||!Buffer.from(previous.bytes).equals(resource.bytes)))throw Error('Conflicting admitted offline resource');resources.set(url,resource);}
 const used=new Set<string>();
 const get=(url:string)=>{const resource=resources.get(url);if(!resource)throw Error(`Offline resource is not admitted: ${new URL(url).pathname}`);used.add(url);return resource;};
 const binary=(value:string,base:string)=>{if(/^(?:data:|#)/i.test(value))return value;if(/^blob:/i.test(value))throw Error('Ephemeral blob resources cannot be exported');const fragment=new URL(value,base).hash,url=canonical(value,base),resource=get(url),mime=type(resource.contentType);if(!/^(?:image|audio|video|font)\//.test(mime)&&!['application/pdf','application/octet-stream','application/json','text/plain'].includes(mime))throw Error('Unexpected binary resource MIME');return encoded(mime,resource.bytes)+fragment;};
 const checkModule=(source:string)=>{const visit=(node:unknown):void=>{if(!node||typeof node!=='object')return;const record=node as Record<string,unknown>;if(record.type==='ImportExpression'&&(!record.source||typeof record.source!=='object'||(record.source as Record<string,unknown>).type!=='Literal'))throw Error('Offline dynamic imports must be literal admitted URLs');for(const value of Object.values(record))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);};visit(parseJavaScript(source,{ecmaVersion:'latest',sourceType:'module'}));};
 const bundle=async(source:string,url:string,loader:'js'|'css')=>{
  if(loader==='js')checkModule(source);
  const result=await build({stdin:{contents:source,sourcefile:url,loader},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',legalComments:'none',logLevel:'silent',outdir:'/offline',plugins:[{name:'admitted-offline-only',setup(builder){
   builder.onResolve({filter:/.*/},args=>{if(['@afbin/apollo','@afbin/reader'].includes(args.path))return {path:args.path,external:true};if(/^(?:data:|#)/i.test(args.path))return {path:args.path,external:true};const resolved=canonical(args.path,args.importer||url);if(args.kind==='url-token')return {path:binary(args.path,args.importer||url),external:true};return {path:resolved,namespace:'admitted'};});
   builder.onLoad({filter:/.*/,namespace:'admitted'},args=>{const resource=get(args.path),mime=type(resource.contentType);let loader:Loader;if(JS.has(mime)){loader='js';checkModule(new TextDecoder().decode(resource.bytes));}else if(mime==='text/css')loader='css';else if(mime==='application/json')loader='json';else if(/^(?:image|font|audio|video)\//.test(mime)||mime==='application/octet-stream')return {contents:'export default '+JSON.stringify(encoded(mime,resource.bytes)),loader:'js'};else throw Error('Unsupported offline resource MIME');return {contents:resource.bytes,loader};});
  }}]});
  const output=result.outputFiles.find(file=>file.path.endsWith(loader==='css'?'.css':'.js'));if(!output)throw Error('Offline dependency bundle has no output');
  const css=loader==='js'?result.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>`<link rel="stylesheet" href="${encoded('text/css',file.contents)}">`).join(''):'';
  return {url:encoded(loader==='css'?'text/css':'text/javascript',output.contents),css};
 };
 const document=parse(input.html,{sourceCodeLocationInfo:true});type Element=DefaultTreeAdapterMap['element'];const elements:Element[]=[];
 const walk=(node:DefaultTreeAdapterMap['node'])=>{if('tagName'in node){elements.push(node);if(node.tagName==='template'&&'content'in node)walk(node.content);}if('childNodes'in node)for(const child of node.childNodes)walk(child);};walk(document);
 const edits:Array<{start:number;end:number;text:string}>=[];let extraCss='';
 for(const element of elements){const attr=(name:string)=>element.attrs.find(a=>a.name===name)?.value;const set=(name:string,value:string)=>{const location=element.sourceCodeLocation?.attrs?.[name];if(location)edits.push({start:location.startOffset,end:location.endOffset,text:`${name}="${escaped(value)}"`});};
  const remove=(name:string)=>{const location=element.sourceCodeLocation?.attrs?.[name];if(location)edits.push({start:location.startOffset,end:location.endOffset,text:''});};
  const src=attr('src'),href=attr('href');
  if(element.tagName==='script'&&attr('data-af')!=='core'&&src!=='/af/v1/core.js'){
   const module=attr('type')==='module';if(src){const resource=get(canonical(src));if(!JS.has(type(resource.contentType)))throw Error('Script resource MIME is not JavaScript');const packed=await bundle(new TextDecoder().decode(resource.bytes),canonical(src),'js');set('src',packed.url);remove('integrity');extraCss+=packed.css;}
   else if(module){const loc=element.sourceCodeLocation;if(loc?.startTag&&loc.endTag){const packed=await bundle(input.html.slice(loc.startTag.endOffset,loc.endTag.startOffset),input.baseUrl,'js');const bytes=Buffer.from(packed.url.split(',')[1]!,'base64').toString();edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:bytes.replace(/<\/script/gi,'<\\/script')});extraCss+=packed.css;}}
  }else if(element.tagName==='link'&&attr('rel')==='stylesheet'&&href){const resource=get(canonical(href));if(type(resource.contentType)!=='text/css')throw Error('Stylesheet resource MIME is not CSS');set('href',(await bundle(new TextDecoder().decode(resource.bytes),canonical(href),'css')).url);remove('integrity');}
  else if(src&&['img','source','video','audio','iframe','embed'].includes(element.tagName))set('src',binary(src,input.baseUrl));
  if(attr('srcset')){const value=attr('srcset')!,candidates:string[]=[];let cursor=0;while(cursor<value.length){while(/[\s,]/.test(value[cursor]??'')&&cursor<value.length)cursor++;const start=cursor;while(cursor<value.length&&!/\s/.test(value[cursor]!))cursor++;const raw=value.slice(start,cursor),url=raw.replace(/,+$/,'');let descriptor='';if(!raw.endsWith(',')){const startDescriptor=cursor;while(cursor<value.length&&value[cursor]!==',')cursor++;descriptor=value.slice(startDescriptor,cursor).trim();}if(url)candidates.push([binary(url,input.baseUrl),descriptor].filter(Boolean).join(' '));}set('srcset',candidates.join(', '));}
  if(element.tagName==='object'&&attr('data'))set('data',binary(attr('data')!,input.baseUrl));
  if(element.tagName==='link'&&href&&['icon','apple-touch-icon'].includes(attr('rel')??''))set('href',binary(href,input.baseUrl));
  if(attr('poster'))set('poster',binary(attr('poster')!,input.baseUrl));
  if(attr('style')){const packed=await bundle('.offline-declarations{'+attr('style')+'}',input.baseUrl,'css');const css=Buffer.from(packed.url.split(',')[1]!,'base64').toString();set('style',css.slice(css.indexOf('{')+1,css.lastIndexOf('}')).trim());}
  if(element.tagName==='style'){const loc=element.sourceCodeLocation;if(loc?.startTag&&loc.endTag){const packed=await bundle(input.html.slice(loc.startTag.endOffset,loc.endTag.startOffset),input.baseUrl,'css');edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:Buffer.from(packed.url.split(',')[1]!,'base64').toString().replace(/<\/style/gi,'<\\/style')});}}
 }
 let html=input.html;for(const edit of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.text+html.slice(edit.end);if(extraCss)html=/<\/head\s*>/i.test(html)?html.replace(/<\/head\s*>/i,extraCss+'</head>'):extraCss+html;return {html,embeddedUrls:[...used]};
}
