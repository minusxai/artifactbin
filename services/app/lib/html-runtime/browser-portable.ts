import {sha256Hex} from '@artifactbin/utils/sha256';
import { recoverPortableSource,recoverPortableRendering,portableRenderedDigest } from './portable-source';
import { portableScript } from './portable';
import type { PortableCopyOptions } from './portable-contract';

/** Parse canonical author bytes in an inert document; never clone the running page. */
export function serializePortableCopy(options: PortableCopyOptions): string {
 const {document:live,portable}=options;
 const parser=new DOMParser();
 const recovered=recoverPortableSource(options.sourceBytes);
 const adopt=options.publishedSource&&sha256Hex(recovered)===options.publishedSource.localSourceDigest;
 const source=adopt?options.publishedSource!.source:recovered;
 const rendered=recoverPortableRendering(options.sourceBytes);
 const target=parser.parseFromString(rendered,'text/html');
 if(adopt){
  const canonical=parser.parseFromString(source,'text/html');
  const authored=(doc:Document)=>[...doc.querySelectorAll('*')].filter(node=>!(node.tagName==='SCRIPT'&&(node.getAttribute('src')==='/af/v1/core.js'||node.getAttribute('data-af')==='core')));
  const before=authored(target),after=authored(canonical);
  if(before.length!==after.length||before.some((node,index)=>node.tagName!==after[index]!.tagName))throw Error('Published source structure changed; save the linked copy from the platform');
  for(let index=0;index<before.length;index++){const id=after[index]!.getAttribute('data-af-id');if(id)before[index]!.setAttribute('data-af-id',id);}
 }
 const renderedSource=(rendered.match(/^\s*(<!doctype[^>]*>)/i)?.[1]??'')+target.documentElement.outerHTML;
 const envelope={version:1 as const,source,...(portable.identity?{identity:portable.identity}:{}),...((portable.renderedDigest||adopt)?{renderedDigest:portableRenderedDigest(renderedSource)}:{}),...(options.privateState?{privateState:options.privateState}:{})};
 const block=parser.parseFromString(portableScript(envelope),'text/html').querySelector('script')!;
 for(const old of target.querySelectorAll('script[data-af="core"],script[src="/af/v1/core.js"]')) old.remove();
 const fragments:Node[]=[];
 for(const name of ['runtime','apollo','reader','chrome','portable-engine','core']) {
  const source=live.querySelector(`script[data-af="${name}"]`);
  if(!source&&(name==='chrome'||name==='portable-engine'))continue;
  if(!source) throw new Error(`Portable HTML is missing its ${name} module`);
  const copy=target.importNode(source,true);
  if(name==='runtime') {
   const config=JSON.parse(copy.textContent??'{}');
   delete config.appOrigin;
   delete config.localPreview;
   delete config.initialState;
   config.offline=true;
   if(portable.identity){config.pageId=portable.identity.artifactId;config.revision=portable.identity.baseRevision;}
   config.savedNodeIds=[...target.querySelectorAll('[data-af-id]')].map(node=>node.getAttribute('data-af-id'));
   config.backends=[...target.querySelectorAll('link[data-af-name]')].filter(node=>(node.getAttribute('rel')??'').split(/\s+/).some(rel=>rel==='af-backend'||rel==='af-dataset')).map(node=>node.getAttribute('data-af-name'));
   config.bindings=Object.fromEntries([...target.querySelectorAll('link[data-af-name][href^="ref:"]')].map(node=>[node.getAttribute('data-af-name'),node.getAttribute('href')!.slice(4)]));
   if(options.privateState)config.initialState=options.privateState;
   copy.textContent=JSON.stringify(config).replace(/</g,'\\u003c');
  }
  fragments.push(copy);
 }
 target.head.prepend(block,...fragments);
 return (source.match(/^\s*(<!doctype[^>]*>)/i)?.[1]??'')+target.documentElement.outerHTML;
}

export function downloadPortableCopy(win: Window, html: string, filename='page.html'): void {
 const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));
 const link=win.document.createElement('a');link.href=url;link.download=filename;
 link.click();
 win.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
