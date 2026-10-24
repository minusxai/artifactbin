/** Host-only, private reviewed recipe. These paths and bytes never enter page code. */
/** @public Host adapter contract. */
export interface NativeHostFile {path:string;sha256:string}
/** @public Host adapter contract. */
export interface NativeHostKey {sourceNamespace:string;sourceId:string;version:number}
/** @public Host adapter contract. */
export interface NativeHostRecipe {
 format:'native-migration-host-v1';revisionScope:'latest';
 key:NativeHostKey;assemblySha256:string;sourceRevision:string;targetRevision:string;
 inputs:Record<'sourceHead'|'compiledHtml'|'datasetCatalog'|'identity'|'authSchemaCapability'|'membership'|'comments',NativeHostFile>;
 /** Explicit reviewed authority. Empty capability sets cannot authorize migration. */
 authority:{appSchema:string;authSchema:string;capabilities:readonly string[]};
}
/** @public Host adapter contract. */
export interface NativeHostContext {
 revision:{key:NativeHostKey};assembly:{key:NativeHostKey;sha256:string;result:{htmlSha256:string}};
 receiptRoot:string;outputDirectory:string;authorityRecipePath:string;baselineRecipePath?:string;candidateRecipePath?:string;
}
/** @public Host adapter contract. */
export interface NativeHostPrepared {
 key:NativeHostKey;assemblySha256:string;stage:'imported';historyProjectionSha256:string;
 preparedStorePath:string;pilotInputPath:string;canonicalPath:string;recoveryPath:string;bundleDirectory:string;
}
/** @public Host adapter contract. */
export interface NativeHostComparison {
 key:NativeHostKey;assemblySha256:string;status:'verified'|'difference'|'environment-blocked';
 comparisonPath:string;comparisonSha256:string;baselineEvidencePath:string;candidateEvidencePath:string;
}
/** Product adapters own staging, transaction authority, readback and the existing actual-reader camera.
 * The host never manufactures authority, source HTML, datasets or camera evidence. */
export interface NativeMigrationHostPorts<Staged,Tx> {
 stage(input:{recipe:NativeHostRecipe;files:Record<keyof NativeHostRecipe['inputs'],Uint8Array>;context:NativeHostContext}):Promise<Staged>;
 transaction<T>(authority:NativeHostRecipe['authority'],work:(tx:Tx)=>Promise<T>):Promise<T>;
 importHistory(tx:Tx,staged:Staged):Promise<{historyProjectionSha256:string}>;
 verify(tx:Tx,staged:Staged):Promise<void>;
 snapshot(staged:Staged,context:NativeHostContext):Promise<Omit<NativeHostPrepared,'key'|'assemblySha256'|'stage'|'historyProjectionSha256'>>;
 captureAndCompare(input:NativeHostContext&{imported:NativeHostPrepared;baselineRecipePath:string;candidateRecipePath:string}):Promise<NativeHostComparison>;
}
