import { recoverPortableSource,recoverPortableRendering,portableRenderedDigest } from './portable-source';
import { portableScript } from './portable';
import type { PortableCopyOptions } from './portable-contract';

/** Parse canonical author bytes in an inert document; never clone the running page. */
export function serializePortableCopy(options: PortableCopyOptions): string {
 const {document:live,portable}=options;
 const parser=new DOMParser();
 const source=recoverPortableSource(options.sourceBytes);
 const rendered=recoverPortableRendering(options.sourceBytes);
 const target=parser.parseFromString(rendered,'text/html');
 const envelope={...portable,source,...(portable.renderedDigest?{renderedDigest:portableRenderedDigest(rendered)}:{}),...(options.privateState?{privateState:options.privateState}:{})};
 const block=parser.parseFromString(portableScript(envelope),'text/html').querySelector('script')!;
 for(const old of target.querySelectorAll('script[data-af="core"],script[src="/af/v1/core.js"]')) old.remove();
 const fragments:Node[]=[];
 for(const name of ['runtime','apollo','reader','core']) {
  const source=live.querySelector(`script[data-af="${name}"]`);
  if(!source) throw new Error(`Portable HTML is missing its ${name} module`);
  const copy=target.importNode(source,true);
  if(name==='runtime') {
   const config=JSON.parse(copy.textContent??'{}');
   delete config.appOrigin;
   config.offline=true;
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
