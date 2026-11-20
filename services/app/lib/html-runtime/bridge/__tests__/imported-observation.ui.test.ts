import {afterEach,expect,it,vi} from 'vitest';
import {hasImportedSourceObservation} from '../imported-observation';
import {observeSourceAnnotations} from '../observe';
const stops:Array<()=>void>=[];
afterEach(()=>{for(const stop of stops.splice(0))stop();document.body.innerHTML='';vi.restoreAllMocks();});
it('requires complete matching import identity and hashes, never an authored DOM flag',()=>{
 const receipt={sourceNamespace:'source-snapshot',sourceId:'page1',selectionSha256:'a'.repeat(64),projectionSha256:'b'.repeat(64),inputSha256:'c'.repeat(64)};
 expect(hasImportedSourceObservation({id:'page1',meta:{nativeImport:receipt}})).toBe(true);
 for(const nativeImport of [{...receipt,sourceId:'other'},{...receipt,projectionSha256:'bad'},{...receipt,sourceNamespace:''},null])expect(hasImportedSourceObservation({id:'page1',meta:{nativeImport}})).toBe(false);
 expect(hasImportedSourceObservation({id:'page1',meta:{annotationObservation:'imported-source-v1'}})).toBe(false);
});
it('preserves source geometry on panel attributes but refreshes text, insertions and input reflow',async()=>{
 document.body.innerHTML='<main><section><h2>Heading</h2></section></main>';
 const root=document.querySelector('main')!,panel=document.querySelector('section')!,text=document.querySelector('h2')!.firstChild!;
 const repaint=vi.fn();const queued:FrameRequestCallback[]=[];vi.spyOn(window,'requestAnimationFrame').mockImplementation(cb=>{queued.push(cb);return queued.length;});vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
 const observation=observeSourceAnnotations(window,{root,ownsOverlay:()=>false,repaint});stops.push(()=>observation.dispose());
 const flush=async()=>{await Promise.resolve();for(const cb of queued.splice(0))cb(0);};
 panel.hidden=true;panel.setAttribute('aria-hidden','true');await flush();expect(repaint).toHaveBeenCalledTimes(0);
 text.textContent='Changed';await flush();expect(repaint).toHaveBeenCalledTimes(1);
 panel.append(document.createTextNode('more'));await flush();expect(repaint).toHaveBeenCalledTimes(2);
 document.dispatchEvent(new Event('input'));await flush();expect(repaint).toHaveBeenCalledTimes(3);
 panel.append(document.createElement('style'));await flush();expect(repaint).toHaveBeenCalledTimes(3);
 observation.dispose();text.textContent='disposed';document.dispatchEvent(new Event('input'));await flush();expect(repaint).toHaveBeenCalledTimes(3);
});
