/** Shared editor navigation. Storage adapters supply history; navigation and its UX stay the same. */
import type {ReactNode} from 'react';
import {Check,Code,Paintbrush} from 'lucide-react';
import {LEFT_RAIL_W} from '@/lib/story/edit-bar';
export function ArtifactParts({top,mode,queriesOpen=false,onModeChange,extraViews,children,onDone}:{top:number;mode:'design'|'code';queriesOpen?:boolean;onModeChange:(mode:'design'|'code')=>void;extraViews?:ReactNode;children:ReactNode;onDone:()=>void}){
 return <nav aria-label="Artifact parts" className="fixed left-0 bottom-0 z-40 flex flex-col border-r border-edge bg-surface" style={{top,width:LEFT_RAIL_W}}>
  <div className="flex flex-col gap-0.5 p-2">
   {([['design','app',<Paintbrush key="d" size={14}/>,mode==='design'&&!queriesOpen],['code','code',<Code key="c" size={14}/>,mode==='code']] as const).map(([next,label,icon,active])=><button key={next} type="button" aria-label={next==='design'?'Edit on the page':'Edit the source'} aria-pressed={active} onClick={()=>onModeChange(next)} className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-[4px] px-2 font-mono text-[11px] ${active?'bg-accent-soft text-accent':'text-muted hover:bg-raised hover:text-fg'}`}>{icon}<span>{label}</span></button>)}
   {extraViews}
  </div>
  <div className="flex min-h-0 flex-1 flex-col border-t border-edge"><p className="px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-faint">versions</p>{children}</div>
  <div className="border-t border-edge p-2"><button type="button" aria-label="Done editing" onClick={event=>{event.currentTarget.blur();onDone();}} className="inline-flex h-8 w-full cursor-pointer items-center gap-2 rounded-[4px] border border-accent/40 bg-accent-soft px-2 font-mono text-[11px] text-accent hover:border-accent"><Check size={13}/><span>done editing</span></button></div>
 </nav>;
}
