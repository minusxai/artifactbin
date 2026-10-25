/** Author-owned read-only view of existing native bindings; no additional watches or request authority. */
export interface NativeObserverSnapshot {
 active:boolean;
 values:Readonly<Record<string,string|number|boolean|null>>;
 queries:Readonly<Record<string,{rows:readonly Readonly<Record<string,unknown>>[]|null;loading:boolean;error:string|null}>>;
}
export type NativeBindingObserve=(next:(snapshot:NativeObserverSnapshot)=>void)=>()=>void;
export interface NativeObserverScriptPlan {values:readonly string[];queries:readonly string[]}

/** Admitted click callbacks retain the native Event and an optional literal capture flag. */
export interface NativeObserverListener {
 host:EventTarget; event:'click'; handler:(event:Event)=>void; capture?:boolean;
}
