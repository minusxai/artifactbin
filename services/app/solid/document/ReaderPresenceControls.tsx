/* @jsxImportSource solid-js */
import {createSignal,For,Show} from 'solid-js';
import type {ReaderPreferences,PresenceViewer} from '@/lib/html-presence/contract';
import {Button} from '../ui/Button';
import {Popover} from '../ui/Popover';
import {Switch} from '../ui/Checkbox';

const SETTINGS:readonly [keyof ReaderPreferences,string][]=[
 ['visible','Show me to other readers'],
 ['shareCursor','Share my cursor'],
 ['shareSelection','Share my selections'],
 ['showCursors','Show other cursors'],
 ['showSelections','Show other selections'],
];

/** Viewer-owned preferences; the parent alone publishes presence and saves changes. */
export function ReaderPresenceControls(props:{
 preferences:ReaderPreferences;
 onChange:(name:keyof ReaderPreferences,value:boolean)=>void;
 viewers:readonly PresenceViewer[];
}){
 const [open,setOpen]=createSignal(false);
 return <Popover open={open()} onOpenChange={setOpen} label="Reader presence" align="end" class="w-72 max-w-[calc(100vw-2rem)] p-4"
  trigger={attrs=><Button {...attrs} variant="ghost" size="sm" onClick={()=>setOpen(value=>!value)} aria-label={`Readers · ${props.viewers.length}`}>Readers · {props.viewers.length}</Button>}>
  <p class="mb-2 font-sans text-sm font-medium">Here now · {props.viewers.length}</p>
  <ul aria-label="Other readers" class="mb-4 max-h-32 overflow-y-auto font-sans text-sm text-muted">
   <For each={props.viewers} fallback={<li>No other readers here</li>}>{viewer=><li class="truncate py-1">{viewer.label}</li>}</For>
  </ul>
  <div class="space-y-3 border-t border-edge pt-3">
   <For each={SETTINGS}>{([name,label])=><div class="flex items-center justify-between gap-3"><span class="font-sans text-sm">{label}</span><Switch size="sm" label={label} checked={props.preferences[name]} onChange={value=>props.onChange(name,value)}/></div>}</For>
  </div>
  <Show when={!props.preferences.visible}><p class="mt-3 font-sans text-xs text-muted">You are hidden from other readers.</p></Show>
 </Popover>;
}
