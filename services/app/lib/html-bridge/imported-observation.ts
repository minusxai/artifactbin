/** Only a complete server-kept import receipt selects the historical source lifecycle. */
export interface ImportedObservationRow { id:string; meta:unknown }
export function hasImportedSourceObservation(row:ImportedObservationRow):boolean {
 const meta=row.meta as {nativeImport?:unknown}|null;
 const receipt=meta&&typeof meta==='object'&&!Array.isArray(meta)?meta.nativeImport:null;
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return false;
 const value=receipt as Record<string,unknown>;
 return value.sourceId===row.id&&typeof value.sourceNamespace==='string'&&value.sourceNamespace.length>0&&['selectionSha256','projectionSha256','inputSha256'].every(key=>typeof value[key]==='string'&&/^[a-f0-9]{64}$/.test(value[key] as string));
}
export interface HtmlSourceAnnotationReadiness {dispose():void}
/** Source annotations attach after hydration. A native head core must not orphan still-parsing anchors. */
export function startSourceAnnotationReadiness(win:Window,ready:()=>void):HtmlSourceAnnotationReadiness {
 let disposed=false;
 const loaded=()=>{void Promise.resolve(win.document.fonts?.ready).then(()=>{if(!disposed)ready();},()=>{if(!disposed)ready();});};
 if(win.document.readyState==='complete')loaded();else win.addEventListener('load',loaded,{once:true});
 return {dispose(){disposed=true;win.removeEventListener('load',loaded);}};
}
