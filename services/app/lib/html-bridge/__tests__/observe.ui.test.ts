import {afterEach,expect,it,vi} from 'vitest';
import {observeHtmlDom} from '../observe';
import {startSourceAnnotationReadiness} from '../imported-observation';
afterEach(()=>{document.body.innerHTML='';vi.restoreAllMocks();});
const frames=()=>{const queued=new Map<number,FrameRequestCallback>();let next=0;
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(cb=>{queued.set(++next,cb);return next;});
 vi.spyOn(window,'cancelAnimationFrame').mockImplementation(id=>{queued.delete(id);});
 return {pending:()=>queued.size,flush:async()=>{await Promise.resolve();for(const [id,cb] of [...queued]){queued.delete(id);cb(0);}}};};
it('repaints once per frame for authored changes and never for the painter’s own overlay or stamps',async()=>{
 document.body.innerHTML='<main><p>Text</p></main><div data-af="overlay"></div>';
 const overlay=document.querySelector('[data-af="overlay"]')!,p=document.querySelector('p')!,repaint=vi.fn(),raf=frames();
 const observation=observeHtmlDom(window,node=>overlay.contains(node),repaint,record=>record.attributeName==='data-af-comment-block');
 overlay.append(document.createElement('span'));p.setAttribute('data-af-comment-block','x');await raf.flush();expect(repaint).not.toHaveBeenCalled();
 p.textContent='One';p.setAttribute('class','b');p.append('Two');await raf.flush();expect(repaint).toHaveBeenCalledOnce();
 p.textContent='Three';await Promise.resolve();expect(raf.pending()).toBe(1);
 observation.dispose();expect(raf.pending()).toBe(0);p.textContent='Four';await raf.flush();expect(repaint).toHaveBeenCalledOnce();
});
it('treats every mutation as authored by default and ignores a frame that lands after dispose',async()=>{
 document.body.innerHTML='<p>x</p>';const repaint=vi.fn(),raf=frames();
 const observation=observeHtmlDom(window,()=>false,repaint);
 document.querySelector('p')!.setAttribute('data-af-comment-block','x');await Promise.resolve();expect(raf.pending()).toBe(1);
 const [callback]=(window.requestAnimationFrame as unknown as {mock:{calls:[FrameRequestCallback][]}}).mock.calls[0]!;
 observation.dispose();callback(0);expect(repaint).not.toHaveBeenCalled();
});
it('attaches source annotations after load and fonts, at once when the page is complete, never after dispose',async()=>{
 const settle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
 const fake=(readyState:string,fonts?:Promise<unknown>)=>{const target=new EventTarget();return Object.assign(target,{document:{readyState,fonts:fonts?{ready:fonts}:undefined}}) as unknown as Window;};
 const complete=vi.fn();startSourceAnnotationReadiness(fake('complete'),complete);await settle();expect(complete).toHaveBeenCalledOnce();
 const loading=fake('loading'),later=vi.fn();startSourceAnnotationReadiness(loading,later);await settle();expect(later).not.toHaveBeenCalled();
 loading.dispatchEvent(new Event('load'));await settle();expect(later).toHaveBeenCalledOnce();loading.dispatchEvent(new Event('load'));await settle();expect(later).toHaveBeenCalledOnce();
 // A failed font load still attaches; dispose before load or before fonts settle attaches nothing.
 const failed=vi.fn();startSourceAnnotationReadiness(fake('complete',Promise.reject(Error('font'))),failed);await settle();expect(failed).toHaveBeenCalledOnce();
 const early=fake('loading'),never=vi.fn();startSourceAnnotationReadiness(early,never).dispose();early.dispatchEvent(new Event('load'));await settle();expect(never).not.toHaveBeenCalled();
 let release!:()=>void;const pending=vi.fn();startSourceAnnotationReadiness(fake('complete',new Promise<void>(r=>{release=r;})),pending).dispose();release();await settle();expect(pending).not.toHaveBeenCalled();
});
