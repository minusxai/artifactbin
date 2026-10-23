/* @jsxImportSource solid-js */
import {createSignal,onCleanup,onMount,Show,type JSX} from 'solid-js';
import {Button} from '../ui/Button';
export interface ReaderNoticeProps<T> {
 label:string;
 load:()=>Promise<T>;
 children:(module:T)=>JSX.Element;
}
/** Only a requested notice loads its controls. Failed downloads remain visible and retryable. */
export function ReaderNotice<T>(props:ReaderNoticeProps<T>){
 const [module,setModule]=createSignal<T>(),[error,setError]=createSignal(false);
 let alive=true;onCleanup(()=>{alive=false;});
 const load=()=>{setError(false);void props.load().then(value=>{if(alive)setModule(()=>value);},()=>{if(alive)setError(true);});};
 onMount(load);
 return <Show when={module()} keyed fallback={<section aria-label={props.label} class="border-b border-edge bg-surface px-3 py-2 text-sm"><Show when={error()} fallback={<p role="status" aria-busy="true">Loading {props.label.toLowerCase()}…</p>}><p role="alert">Could not load {props.label.toLowerCase()}.</p><Button variant="secondary" size="sm" onClick={load}>Retry</Button></Show></section>}>{value=>props.children(value)}</Show>;
}
