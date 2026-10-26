/** Only a complete server-kept import receipt selects the historical source lifecycle. */
export interface ImportedObservationRow { id:string; meta:unknown }
export function hasImportedSourceObservation(row:ImportedObservationRow):boolean {
 const meta=row.meta as {nativeImport?:unknown}|null;
 const receipt=meta&&typeof meta==='object'&&!Array.isArray(meta)?meta.nativeImport:null;
 if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))return false;
 const value=receipt as Record<string,unknown>;
 return value.sourceId===row.id&&typeof value.sourceNamespace==='string'&&value.sourceNamespace.length>0&&['selectionSha256','projectionSha256','inputSha256'].every(key=>typeof value[key]==='string'&&/^[a-f0-9]{64}$/.test(value[key] as string));
}
