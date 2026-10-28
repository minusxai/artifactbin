import type {NativeJson} from './analyze-contracts.ts';

/** Reviewed ordinary DOM programs only; no JSX, server operations or declared page bindings. */
export interface NativeDomReactiveSource {
 source:string;
 /** Original module-level named signals, in source order. Their values are JSON. */
 namedSignals:readonly string[];
 signalCount:number;
}
/** A module-level original comment key maps to one Apollo JSON cell, never to a fabricated Value. */
export interface NativeDomReactivePlan {named:readonly {name:string;field:string}[]}
export interface NativeDomReactiveCell {value:NativeJson}
/** Apollo local state owns saved viewer values. Unnamed application signals are unsupported. */
export interface NativeDomReactiveState {
 open(key:string,initial:NativeJson,changed:(value:NativeJson)=>void):{
  read():NativeJson;
  write(value:NativeJson):void;
  close():void;
 };
 dispose():void;
}
export interface NativeDomReactiveRuntime {
 createSignal<T extends NativeJson>(initial:T,options?:{name?:string;equals?:false|((a:T,b:T)=>boolean)}):readonly [()=>T,(value:T|((previous:T)=>T))=>T];
 createEffect(effect:()=>void):void;
 onMount(effect:()=>void):void;
 onCleanup(cleanup:()=>void):void;
 listen(host:EventTarget,event:string,listener:EventListenerOrEventListenerObject,options?:boolean|AddEventListenerOptions):void;
 run(body:()=>void):void;
 dispose():void;
}
