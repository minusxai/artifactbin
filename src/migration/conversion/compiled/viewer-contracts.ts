/** Public routing only. Executing page/backend/source namespace is registered server-side. */
export interface CompiledViewerBinding {backendNamespace:string;backendHref:string}
export interface CompiledViewerSnapshot {generation:string;id:string|null}
export interface CompiledViewerOptions {
 /** undefined is pending; null is unavailable; only an exact receipt can mean guest. */
 watch(listener:(snapshot:unknown)=>void):()=>void;
 /** Must apply identity and dependent query results while the content stays gated. */
 apply(snapshot:CompiledViewerSnapshot,signal:AbortSignal):Promise<void>;
 clear():void;
 gate(state:'pending'|'unavailable'|'ready'):void;
}
export interface CompiledViewerAdapter {dispose():void}
