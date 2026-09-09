import type {ManagedIframeContent} from '@/lib/story/managed-iframe';
import {URL_ATTRS,URL_LIST_ATTRS,SVG_PAINT_ATTRS} from '@/lib/jsx/url-attrs';
import {parsePing,parseSrcset} from '@/lib/story/managed-url-list';
export interface ManagedAssetsConfig {origin: string; resolveUrl: string}
export type ManagedAssetKind='image'|'font'|'pdf'|'script'|'binary';
export type ManagedAssetRelay=(url:string,kind?:ManagedAssetKind,signal?:AbortSignal)=>Promise<{url:string}|{refused:string}>;
export interface ManagedAssetResolver {
  resolve(url:string,kind:ManagedAssetKind):Promise<string>;
  dispose():void;
}
export function isManagedAssetUrl(url:URL,origin:string):boolean {
  return url.origin===origin&&!url.username&&!url.password&&!url.hash&&(
    (/^\/assets\/[a-f0-9]{64}$/.test(url.pathname)&&[...url.searchParams.keys()].every(key=>key==='v'||key==='w'))||
    (/^\/assets\/ref\/[A-Za-z0-9]{6}$/.test(url.pathname)&&!url.search)
  );
}
export function createManagedAssetResolver(config?:ManagedAssetsConfig,relay?:ManagedAssetRelay):ManagedAssetResolver {
  const controller=new AbortController(),cache=new Map<string,Promise<string>>();
  let disposed=false,active=0,count=0,windowStart=Date.now();
  return {
    async resolve(input,kind) {
      if(disposed)throw Error('Asset resolver disposed');
      if(!config)throw Error('External iframe assets are not configured');
      if(!['image','font','pdf','script','binary'].includes(kind)||typeof input!=='string'||input.length>4096)throw Error('Invalid asset request');
      const ref=/^ref:[A-Za-z0-9]{6}$/.test(input);
      const url=new URL(input),origin=new URL(config.origin),endpoint=new URL(config.resolveUrl);
      if((!ref&&!/^https?:$/.test(url.protocol))||url.username||url.password||!/^https?:$/.test(origin.protocol)||origin.origin!==config.origin||!/^\/a\/[A-Za-z0-9]{6,12}\/assets$/.test(endpoint.pathname)||[...endpoint.searchParams.keys()].some(key=>key!=='key')||endpoint.hash)throw Error('Invalid asset URL');
      if(isManagedAssetUrl(url,origin.origin))return url.href;
      const key=kind+':'+url.href;
      if(!ref&&cache.has(key))return cache.get(key)!;
      if(Date.now()-windowStart>=60000){windowStart=Date.now();count=0;}
      if(active>=16||++count>120||cache.size>=256)throw Error('Iframe asset limit exceeded');
      active++;
      endpoint.searchParams.set('u',url.href);endpoint.searchParams.set('kind',kind);
      const result=(async()=>{
        let answer:{url:string};
        if(relay) {
          const reply=await relay(input,kind,controller.signal);
          if('refused'in reply)throw Error('Asset import refused: '+reply.refused);
          answer=reply;
        } else {
        // This is the platform's scoped API, never author-selected credentials or verbs.
        const response=await fetch(endpoint.href,{headers:{Accept:'application/json'},credentials:'same-origin',redirect:'error',signal:controller.signal});
        if(!response.ok)throw Error('Asset import failed: '+response.status);
        const reader=response.body?.getReader(),decoder=new TextDecoder();let text='',bytes=0;
        if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>8192){await reader.cancel();throw Error('Invalid asset response');}text+=decoder.decode(chunk.value,{stream:true});}
        text+=decoder.decode();
        answer=JSON.parse(text);
        }
        const resolved=new URL(answer.url);
        if(disposed)throw Error('Asset resolver disposed');
        if(!isManagedAssetUrl(resolved,origin.origin))throw Error('Asset response escaped asset origin');
        if(ref&&(resolved.pathname!=='/assets/ref/'+input.slice(4)||resolved.search))throw Error('Invalid ref asset response');
        return resolved.href;
      })().finally(()=>{active--;});
      if(!ref)cache.set(key,result);
      return result;
    },
    dispose(){disposed=true;controller.abort();cache.clear();},
  };
}
export async function prepareManagedContent(content:ManagedIframeContent,resolver:ManagedAssetResolver,doc:Document):Promise<ManagedIframeContent> {
  const template=doc.createElement('template');template.innerHTML=content.html;
  // Resolve independent declarations together, below the resolver's 16-request
  // ceiling. Only the inert template is modified; nothing mounts until all jobs
  // succeed. Scripts keep their source order regardless of completion order.
  const jobs:Array<()=>Promise<void>>=[];
  let count=0;
  const resolve=async(url:string,kind:ManagedAssetKind)=>{
    if(url.startsWith('#')||/^data:image\//i.test(url))return url;
    if(++count>128)throw Error('Too many declared iframe assets');
    return resolver.resolve(url,kind);
  };
  const css=async(source:string)=>{
    if(/\\|@import|image-set\s*\(/i.test(source))throw Error('Iframe CSS imports, escapes and image-set are unsupported');
    const matches=[...source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi)];
    let result='',cursor=0;
    for(const match of matches){const url=match[1]??match[2]??match[3];result+=source.slice(cursor,match.index)+`url("${await resolve(url,'binary')}")`;cursor=match.index!+match[0].length;}
    return result+source.slice(cursor);
  };
  for(const element of template.content.querySelectorAll('*')) jobs.push(async()=>{
    for(const attr of [...element.attributes]) {
      if(attr.name==='cite'||(attr.name==='href'&&['A','AREA'].includes(element.tagName)))continue;
      if(URL_LIST_ATTRS.has(attr.name)) {
        if(attr.name==='srcset') {
          const parts=[];for(const item of parseSrcset(attr.value))parts.push([await resolve(item.url,'image'),item.descriptor].filter(Boolean).join(' '));element.setAttribute(attr.name,parts.join(', '));
        } else {
          const parts=[];for(const url of parsePing(attr.value))parts.push(await resolve(url,'binary'));element.setAttribute(attr.name,parts.join(' '));
        }
      } else if(URL_ATTRS.has(attr.name)) element.setAttribute(attr.name,await resolve(attr.value,element.tagName==='IMG'?'image':'binary'));
      else if(attr.name==='style'||SVG_PAINT_ATTRS.has(attr.name))element.setAttribute(attr.name,await css(attr.value));
    }
    if(element.tagName==='STYLE')element.textContent=await css(element.textContent??'');
  });
  const scripts=[...content.scripts];
  content.scripts.forEach((script,index)=>{
    if(script.src)jobs.push(async()=>{scripts[index]={...script,src:await resolve(script.src!,'script')};});
  });
  let next=0,failed=false;
  await Promise.all(Array.from({length:Math.min(8,jobs.length)},async()=>{
    while(!failed&&next<jobs.length){
      const job=jobs[next++];
      try {await job();} catch(error){failed=true;throw error;}
    }
  }));
  return {html:template.innerHTML,scripts};
}
