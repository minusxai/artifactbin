/** Public immutable code only, in a namespace separate from private artifact objects. */
export interface RuntimeAssetStore {
 get(digest:string):Promise<string|null>;
 put(digest:string,source:string):Promise<void>;
}
/** The same retention over any list of public sources: `digests` in the order given. */
export interface SourceRetention {
 digests:readonly string[];
 expose():Promise<void>;
 read(digest:string):Promise<string|null>;
}
