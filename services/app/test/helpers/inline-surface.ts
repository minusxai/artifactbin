import { vi } from 'vitest';
import type { ArtifactSurfaceProps } from '@/components/ArtifactSurface';
export const surfaceProps = (over:Partial<ArtifactSurfaceProps> = {}):ArtifactSurfaceProps => ({
 id:'story1',editId:'edit_1',format:'markup',title:'Document',source:'<p>Document body</p>',template:null,refs:[],version:1,content:'',columns:[],compiledCss:null,theme:null,colorMode:null,...over,
});
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
export function setupSurface(){localStorage.clear();window.history.replaceState(null,'','/a/story1');vi.stubGlobal('EventSource',SurfaceEvents);}
