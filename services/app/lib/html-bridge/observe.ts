/** DOM invalidation observes authored changes, never the painter's own inert overlay. */
export interface HtmlDomObservation {dispose():void}
export function observeHtmlDom(win:Window,ownsOverlay:(node:Node)=>boolean,repaint:()=>void):HtmlDomObservation {
 let frame:number|null=null;
 let disposed=false;
 const observer=new MutationObserver(records=>{
  if(disposed || frame!==null || !records.some(record=>!ownsOverlay(record.target)))return;
  frame=win.requestAnimationFrame(()=>{frame=null;if(!disposed)repaint();});
 });
 observer.observe(win.document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
 return {dispose(){disposed=true;observer.disconnect();if(frame!==null)win.cancelAnimationFrame(frame);frame=null;}};
}
