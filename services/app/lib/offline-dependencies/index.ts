import { escapeSourceAttribute } from '@artifactbin/utils/escape';
import {isRuntimeCoreSrc} from '../html-page';
import {parse as parseJavaScript} from 'acorn';
import {createHash} from 'node:crypto';
import {build,transform,type Loader} from 'esbuild';
import {initSync,parse as parseModuleImports} from 'es-module-lexer';
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {libraryPathForSpecifier} from '../libraries';
import {OFFLINE_MODULES_BLOCK,type OfflineEmbeddedModules,type OfflineDependencyInput,type OfflineDependencyResult} from './contracts';
export type {OfflineDependencyInput,OfflineDependencyResult} from './contracts';
export const OFFLINE_DEPENDENCY_LIMITS={resources:256,resourceBytes:16*1024*1024,totalBytes:16*1024*1024,htmlBytes:4*1024*1024} as const;
const JS=new Set(['application/javascript','text/javascript','application/ecmascript','text/ecmascript']);
const type=(mime:string)=>mime.split(';')[0]!.trim().toLowerCase();
type Edit={start:number;end:number;text:string};
const encoded=(mime:string,bytes:Uint8Array)=>`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
/** The platform's own modules, which every page gets from its import map: never packed. */
const PLATFORM_MODULES=['@afbin/apollo','@afbin/reader','@afbin/collab','@afbin/state'];
/** Two admitted copies of one resource agree on its type and bytes. */
const same=(a:{contentType:string;bytes:Uint8Array},b:{contentType:string;bytes:Uint8Array})=>a.contentType===b.contentType&&Buffer.from(a.bytes).equals(b.bytes);
/** Every node of a parsed script, depth first. */
const everyNode=(node:unknown,visit:(record:Record<string,unknown>)=>void):void=>{if(!node||typeof node!=='object')return;const record=node as Record<string,unknown>;visit(record);for(const value of Object.values(record))if(Array.isArray(value))value.forEach(child=>everyNode(child,visit));else if(value&&typeof value==='object')everyNode(value,visit);};
export async function packOfflineDependencies(input:OfflineDependencyInput):Promise<OfflineDependencyResult>{
 const {links,...source}=input;
 return (await prepareOfflineDependencies(source,links?.origin)).render(links?.embed===true);
}

/** Transform admitted runtime resources once. Only the copy's admitted anchor and area links vary with size. */
export async function prepareOfflineDependencies(input:Omit<OfflineDependencyInput,'links'>,linkOrigin?:string){
 const limits=OFFLINE_DEPENDENCY_LIMITS;if(Buffer.byteLength(input.html)>limits.htmlBytes||input.resources.length>limits.resources)throw Error('Offline dependency input limit exceeded');let total=0;for(const resource of input.resources){if(resource.bytes.byteLength>limits.resourceBytes||(total+=resource.bytes.byteLength)>limits.totalBytes)throw Error('Offline dependency byte limit exceeded');}
 const canonical=(value:string,base=input.baseUrl)=>{const url=new URL(value,base);if(url.username||url.password||[...url.searchParams.keys()].some(key=>/^(?:token|key|authorization|access_token|_pt)$/i.test(key)))throw Error('Offline resource URL contains credentials');if(!['https:','http:'].includes(url.protocol))throw Error('Unsupported offline resource URL');url.hash='';return url.href;};
 const resources=new Map<string,{contentType:string;bytes:Uint8Array;name?:string}>();
 for(const resource of input.resources){const url=canonical(resource.url),previous=resources.get(url);if(previous&&!same(previous,resource))throw Error('Conflicting admitted offline resource');resources.set(url,resource);}
 // This route serves receipt-selected immutable bytes. Other query parameters
 // select the parent presentation, never a different child revision.
 const assetIdentity=(value:string)=>{const url=new URL(value);if(!/^\/a\/[A-Za-z0-9_-]+\/assets$/.test(url.pathname))return null;const values=['dependency','revision'].map(key=>url.searchParams.getAll(key));if(values.some(items=>items.length!==1||!items[0]))return null;return JSON.stringify([url.origin,url.pathname,values[0]![0],values[1]![0]]);};
 const aliases=new Map<string,string>();
 for(const [url,resource]of resources){const identity=assetIdentity(url);if(!identity)continue;const previous=aliases.get(identity);if(previous){if(!same(resources.get(previous)!,resource))throw Error('Conflicting admitted offline asset aliases');}else aliases.set(identity,url);}
 const used=new Set<string>(),usedWithLinks=new Set<string>();
 const get=(url:string)=>{const key=resources.has(url)?url:aliases.get(assetIdentity(url)??''),resource=key?resources.get(key):undefined;if(!resource)throw Error(`Offline resource is not admitted: ${new URL(url).pathname}`);used.add(key!);usedWithLinks.add(key!);return resource;};
 // The file published with the page a link names, if any: only its asset door's address, never mailto:, a page or code.
 const linked=(value:string)=>{let url:string;try{url=canonical(value);}catch{return undefined;}const identity=assetIdentity(url);return identity?(resources.has(url)?url:aliases.get(identity)):undefined;};
 const binary=(value:string,base:string)=>{if(/^(?:data:|#)/i.test(value))return value;if(/^blob:/i.test(value))throw Error('Ephemeral blob resources cannot be exported');const fragment=new URL(value,base).hash,url=canonical(value,base),resource=get(url),mime=type(resource.contentType);if(!/^(?:image|audio|video|font)\//.test(mime)&&!['application/pdf','application/octet-stream','application/json','text/plain'].includes(mime))throw Error('Unexpected binary resource MIME');return encoded(mime,resource.bytes)+fragment;};
 const checkClassic=(source:string)=>everyNode(parseJavaScript(source,{ecmaVersion:'latest',sourceType:'script'}),record=>{if(record.type==='ImportExpression'||record.type==='CallExpression'&&['require','importScripts'].includes(String((record.callee as Record<string,unknown>)?.name)))throw Error('Classic script dependencies are unsupported in offline export');});
 const dataResource=(value:string)=>{const comma=value.indexOf(',');if(!/^data:/i.test(value)||comma<0)throw Error('Invalid self-contained resource');const header=value.slice(5,comma).split(';'),mime=header.shift()||'text/plain',payload=value.slice(comma+1).split('#')[0]!;const bytes=header.some(part=>part.toLowerCase()==='base64')?Buffer.from(payload,'base64'):Buffer.from(decodeURIComponent(payload));if(bytes.length>limits.resourceBytes)throw Error('Offline dependency byte limit exceeded');return {contentType:mime,bytes};};
 const checkModule=(source:string,selfContained=false)=>everyNode(parseJavaScript(source,{ecmaVersion:'latest',sourceType:'module'}),record=>{const imported=(record.source as Record<string,unknown>|undefined)?.value;if(selfContained&&typeof imported==='string'&&record.type&&['ImportExpression','ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(String(record.type))&&!PLATFORM_MODULES.includes(imported)){if(!/^data:/i.test(imported))throw Error('Self-contained module has an unresolved dependency');const child=dataResource(imported);if(!JS.has(type(child.contentType)))throw Error('Script resource MIME is not JavaScript');checkModule(new TextDecoder().decode(child.bytes),true);}if(record.type==='ImportExpression'&&(!record.source||typeof record.source!=='object'||(record.source as Record<string,unknown>).type!=='Literal'))throw Error('Offline dynamic imports must be literal admitted URLs');});
 // Only already-closed ESM modules can bypass graph bundling. Keep native
 // module identity without building a second enormous JavaScript AST in Node.
 initSync();
 const closedModules=new Map<string,Promise<string|null>>(),embeddedModules:Record<string,string>={};
 const closedModule=(url:string):Promise<string|null>=>{
  const identity=assetIdentity(url)??url,cached=closedModules.get(identity);if(cached)return cached;
  const pending=(async()=>{
   const resource=get(url);if(!JS.has(type(resource.contentType)))return null;
   const source=new TextDecoder().decode(resource.bytes),[imports,exports]=parseModuleImports(source);
   // CommonJS/side-effect scripts and dependency graphs retain esbuild's path.
   if(imports.length||!exports.length)return null;
   const validated=await transform(source,{loader:'js',format:'esm',target:'es2022',logLevel:'silent'});
   if(validated.warnings.some(warning=>warning.id==='commonjs-variable-in-esm'))return null;
   const specifier='@afbin/offline/'+createHash('sha256').update(identity).update('\0').update(resource.bytes).digest('hex');
   embeddedModules[specifier]=source;return specifier;
  })();closedModules.set(identity,pending);return pending;
 };
 const bundle=async(source:string,url:string,loader:'js'|'css')=>{
  if(loader==='js')checkModule(source);
  const result=await build({stdin:{contents:source,sourcefile:url,loader},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',legalComments:'none',logLevel:'silent',outdir:'/offline',plugins:[{name:'admitted-offline-only',setup(builder){
   builder.onResolve({filter:/.*/},async args=>{if(PLATFORM_MODULES.includes(args.path))return {path:args.path,external:true};args={...args,path:libraryPathForSpecifier(args.path)??args.path};if(/^(?:data:|#)/i.test(args.path))return {path:args.path,external:true};const resolved=canonical(args.path,args.importer||url);if(args.kind==='url-token')return {path:binary(args.path,args.importer||url),external:true};if(args.kind==='import-statement'||args.kind==='dynamic-import'){const shared=await closedModule(resolved);if(shared)return {path:shared,external:true};}return {path:resolved,namespace:'admitted'};});
   builder.onLoad({filter:/.*/,namespace:'admitted'},args=>{const resource=get(args.path),mime=type(resource.contentType);let loader:Loader;if(JS.has(mime)){loader='js';checkModule(new TextDecoder().decode(resource.bytes));}else if(mime==='text/css')loader='css';else if(mime==='application/json')loader='json';else if(/^(?:image|font|audio|video)\//.test(mime)||mime==='application/octet-stream')return {contents:'export default '+JSON.stringify(encoded(mime,resource.bytes)),loader:'js'};else throw Error('Unsupported offline resource MIME');return {contents:resource.bytes,loader};});
  }}]});
  const output=result.outputFiles.find(file=>file.path.endsWith(loader==='css'?'.css':'.js'));if(!output)throw Error('Offline dependency bundle has no output');
  const css=loader==='js'?result.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>`<link rel="stylesheet" href="${encoded('text/css',file.contents)}">`).join(''):'';
  return {url:encoded(loader==='css'?'text/css':'text/javascript',output.contents),text:new TextDecoder().decode(output.contents),css};
 };
 const document=parse(input.html,{sourceCodeLocationInfo:true});type Element=DefaultTreeAdapterMap['element'];const elements:Element[]=[];
 const walk=(node:DefaultTreeAdapterMap['node'])=>{if('tagName'in node){elements.push(node);if(node.tagName==='template'&&'content'in node)walk(node.content);}if('childNodes'in node)for(const child of node.childNodes)walk(child);};walk(document);
 const edits:Edit[]=[];
 const links:Array<{start:number;end:number;url:string;href:string;download?:string}>=[];
 let extraCss='';
 for(const element of elements){const attr=(name:string)=>element.attrs.find(a=>a.name===name)?.value;const set=(name:string,value:string)=>{const location=element.sourceCodeLocation?.attrs?.[name];if(location)edits.push({start:location.startOffset,end:location.endOffset,text:`${name}="${escapeSourceAttribute(value)}"`});};
  const remove=(name:string)=>{const location=element.sourceCodeLocation?.attrs?.[name];if(location)edits.push({start:location.startOffset,end:location.endOffset,text:''});};
  const src=attr('src'),href=attr('href');
  if(element.tagName==='script'&&attr('data-af')!=='core'&&!isRuntimeCoreSrc(src)){
   const module=attr('type')==='module';if(src){const data=/^data:/i.test(src),resource=data?dataResource(src):get(canonical(src));if(!JS.has(type(resource.contentType)))throw Error('Script resource MIME is not JavaScript');const source=new TextDecoder().decode(resource.bytes);if(!module){checkClassic(source);if(!data)set('src',encoded(type(resource.contentType),resource.bytes));}else if(data){checkModule(source,true);}else{const packed=await bundle(source,canonical(src),'js');set('src',packed.url);remove('integrity');extraCss+=packed.css;}}
   else if(module){const loc=element.sourceCodeLocation;if(loc?.startTag&&loc.endTag){const packed=await bundle(input.html.slice(loc.startTag.endOffset,loc.endTag.startOffset),input.baseUrl,'js');edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:packed.text.replace(/<\/script/gi,'<\\/script')});extraCss+=packed.css;}}
  }else if(element.tagName==='link'&&attr('rel')==='stylesheet'&&href){const data=/^data:/i.test(href),resource=data?dataResource(href):get(canonical(href));if(type(resource.contentType)!=='text/css')throw Error('Stylesheet resource MIME is not CSS');set('href',(await bundle(new TextDecoder().decode(resource.bytes),data?input.baseUrl:canonical(href),'css')).url);remove('integrity');}
  else if(src&&['img','source','video','audio','iframe','embed'].includes(element.tagName))set('src',binary(src,input.baseUrl));
  if(attr('srcset')){const value=attr('srcset')!,candidates:string[]=[];let cursor=0;while(cursor<value.length){while(/[\s,]/.test(value[cursor]??'')&&cursor<value.length)cursor++;const start=cursor;while(cursor<value.length&&!/\s/.test(value[cursor]!))cursor++;const raw=value.slice(start,cursor),url=raw.replace(/,+$/,'');let descriptor='';if(!raw.endsWith(',')){const startDescriptor=cursor;while(cursor<value.length&&value[cursor]!==',')cursor++;descriptor=value.slice(startDescriptor,cursor).trim();}if(url)candidates.push([binary(url,input.baseUrl),descriptor].filter(Boolean).join(' '));}set('srcset',candidates.join(', '));}
  if(element.tagName==='object'&&attr('data'))set('data',binary(attr('data')!,input.baseUrl));
  // A link to an admitted file, whatever its type: a download of its bytes (a data: URL opens only as one), or its address.
  const link=(element.tagName==='a'||element.tagName==='area')&&href&&linkOrigin!==undefined?linked(href):undefined;
  const at=element.sourceCodeLocation?.attrs?.href;
  if(link&&at){
   const file=resources.get(link)!;
   const download=attr('download')===undefined?file.name??'':undefined;
   links.push({start:at.startOffset,end:at.endOffset,url:link,href:href!,download});
   usedWithLinks.add(link);
  }
  if(element.tagName==='link'&&href&&['icon','apple-touch-icon'].includes(attr('rel')??''))set('href',binary(href,input.baseUrl));
  if(attr('poster'))set('poster',binary(attr('poster')!,input.baseUrl));
  if(attr('style')){const css=(await bundle('.offline-declarations{'+attr('style')+'}',input.baseUrl,'css')).text;set('style',css.slice(css.indexOf('{')+1,css.lastIndexOf('}')).trim());}
  if(element.tagName==='style'){const loc=element.sourceCodeLocation;if(loc?.startTag&&loc.endTag){const packed=await bundle(input.html.slice(loc.startTag.endOffset,loc.endTag.startOffset),input.baseUrl,'css');edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:packed.text.replace(/<\/style/gi,'<\\/style')});}}
 }
 const moduleBlock=Object.keys(embeddedModules).length
  ? `<script type="application/json" data-af="${OFFLINE_MODULES_BLOCK}">${JSON.stringify(embeddedModules satisfies OfflineEmbeddedModules).replace(/</g,'\\u003c')}</script>`
  : '';
 function render(embedLinks:boolean):OfflineDependencyResult{
  const dataUrls=new Map<string,string>();
  const platformBase=!embedLinks&&links.length?new URL(new URL(input.baseUrl).pathname,linkOrigin):undefined;
  const projected=links.map(({start,end,url,href,download})=>{
   if(platformBase){
    const address=new URL(href,platformBase).href;
    return {start,end,text:`href="${escapeSourceAttribute(address)}"`};
   }
   let dataUrl=dataUrls.get(url);
   if(dataUrl===undefined){
    const file=resources.get(url)!;
    dataUrl=escapeSourceAttribute(encoded(type(file.contentType)||'application/octet-stream',file.bytes));
    dataUrls.set(url,dataUrl);
   }
   const named=download===undefined?'':` download="${escapeSourceAttribute(download)}"`;
   return {start,end,text:`href="${dataUrl}"${named}`};
  });
  let html=input.html;
  for(const edit of [...edits,...projected].sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.text+html.slice(edit.end);
  if(extraCss)html=/<\/head\s*>/i.test(html)?html.replace(/<\/head\s*>/i,extraCss+'</head>'):extraCss+html;
  if(moduleBlock){
   const rendered=parse(html,{sourceCodeLocationInfo:true}),root=rendered.childNodes.find(node=>node.nodeName==='html');
   const head=root&&'childNodes'in root?root.childNodes.find(node=>node.nodeName==='head'):undefined;
   const location=head?.sourceCodeLocation;const at=location&&'startTag'in location?location.startTag?.endOffset??0:0;
   html=html.slice(0,at)+moduleBlock+html.slice(at);
  }
  return {html,embeddedUrls:[...(embedLinks?usedWithLinks:used)]};
 }
 return {render,hasLinks:links.length>0};
}
