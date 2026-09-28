import { vi } from 'vitest';
import type { ArtifactSurfaceProps } from '@/components/ArtifactSurface';
import { parseJsx } from '@/lib/jsx';
import { captureInitialStory, initialDocumentStory } from '@/web/initial-story';
export const surfaceProps = (over:Partial<ArtifactSurfaceProps> = {}):ArtifactSurfaceProps => {
 const source = over.source ?? '<p>Document body</p>';
 const parsed = parseJsx(source);
 const story = initialDocumentStory();
 if (story) {
  if (over.colorMode) story.className = over.colorMode;
  if (over.source && !over.source.includes('<Helmet>')) story.innerHTML = over.source.replace(/^<(\w+)/, '<$1 data-mx-ast="0"');
 }
 return {
  id:'story1',editId:'edit_1',format:'markup',title:'Document',source,template:null,refs:[],version:1,dataPreview:'',columns:[],compiledCss:null,theme:null,colorMode:null,...over,
  runtime: over.runtime ?? { data: { nodes: parsed.ok ? parsed.nodes : [], refData: {}, colorMode: over.colorMode ?? 'light', chrome: true }, css: '' } as never,
 };
};
export class SurfaceEvents {
 static last:SurfaceEvents;
 listeners:Record<string,((event:MessageEvent)=>void)[]> = {};
 onmessage:((event:MessageEvent)=>void)|null = null;
 onerror:((event:MessageEvent)=>void)|null = null;
 close = vi.fn();
 constructor(){SurfaceEvents.last=this;}
 addEventListener(type:string,listener:(event:MessageEvent)=>void){(this.listeners[type]??=[]).push(listener);}
 removeEventListener(type:string,listener:(event:MessageEvent)=>void){this.listeners[type]=(this.listeners[type]??[]).filter(fn=>fn!==listener);}
 emitData(data:unknown){for(const fn of this.listeners.data??[])fn({data:JSON.stringify(data)} as MessageEvent);}
}
export function setupSurface(){
 localStorage.clear();window.history.replaceState(null,'','/a/story1');vi.stubGlobal('EventSource',SurfaceEvents);
 document.body.innerHTML = '<div id="mx-story-root" data-mx-inline-story="" data-mx-story-root="" class="light"><p data-mx-ast="0">Document body</p></div>';
 captureInitialStory();
}
