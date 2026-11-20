/** DOM invalidation observes authored changes, never the painter's own inert overlay. */
export interface HtmlDomObservation {dispose():void}
/** Source observer invalidations affect annotations; ordinary native/presence observation stays broad. */
export interface HtmlSourceAnnotationObservation { root: Node; ownsOverlay(node:Node):boolean; repaint():void }
export function observeHtmlDom(win:Window,ownsOverlay:(node:Node)=>boolean,repaint:()=>void,ownsMutation:(record:MutationRecord)=>boolean=()=>false):HtmlDomObservation {
 let frame:number|null=null;
 let disposed=false;
 const observer=new MutationObserver(records=>{
  if(disposed || frame!==null || !records.some(record=>!ownsOverlay(record.target)&&!ownsMutation(record)))return;
  frame=win.requestAnimationFrame(()=>{frame=null;if(!disposed)repaint();});
 });
 observer.observe(win.document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
 return {dispose(){disposed=true;observer.disconnect();if(frame!==null)win.cancelAnimationFrame(frame);frame=null;}};
}
/** Imported source ignores presentation attributes, exactly as its frame annotation session did.
 * Imported block stamps affect paint only; the broad observer explicitly excludes them.
 * Scroll/resize remain bridge events; input/text/children
 * refresh geometry here, while paint-only styles/area/band/action nodes cannot loop.
 */
export function observeSourceAnnotations(win:Window,options:HtmlSourceAnnotationObservation):HtmlDomObservation {
 let frame:number|null=null,disposed=false;
 const schedule=()=>{if(disposed||frame!==null)return;frame=win.requestAnimationFrame(()=>{frame=null;if(!disposed)options.repaint();});};
 const observer=new MutationObserver(records=>{
  if(records.some(record=>!options.ownsOverlay(record.target)&&(record.type==='characterData'||record.type==='childList'&&[...record.addedNodes,...record.removedNodes].some(node=>!options.ownsOverlay(node)&&(node.nodeType===3||node.nodeType===1&&!(node as Element).matches('style,[data-mx-annotation-area],[data-mx-annotate-band],[data-mx-selection-actions]'))))))schedule();
 });
 observer.observe(options.root,{subtree:true,childList:true,characterData:true});
 win.document.addEventListener('input',schedule,true);
 return {dispose(){disposed=true;observer.disconnect();win.document.removeEventListener('input',schedule,true);if(frame!==null)win.cancelAnimationFrame(frame);frame=null;}};
}
