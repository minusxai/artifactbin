/** Latest-only view ownership. An obsolete asynchronous render can never replace
 * the committed view; every superseded/disposed view is finalized once. */
export interface NativeChartView {finalize():void}
export function nativeChartLifecycle<T extends NativeChartView>(onCommit:(view:T)=>void,onError:(cause:unknown)=>void){
 let generation=0,disposed=false,current:T|undefined;
 return {async render(create:()=>Promise<T>){const attempt=++generation;try{const view=await create();if(disposed||attempt!==generation){view.finalize();return;}const old=current;current=view;old?.finalize();onCommit(view);}catch(cause){if(!disposed&&attempt===generation)onError(cause);}},clear(){++generation;current?.finalize();current=undefined;},dispose(){if(disposed)return;disposed=true;++generation;current?.finalize();current=undefined;}};
}
