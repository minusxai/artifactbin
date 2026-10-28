import type {HtmlRuntimeAssets} from './contract';
/** Public immutable code only, in a namespace separate from private artifact objects. */
export interface RuntimeAssetStore {
 get(digest:string):Promise<string|null>;
 put(digest:string,source:string):Promise<void>;
}
export interface RuntimeAssetRetention {
 /** Resolves only after these bytes are durable; failures remain retryable. */
 expose():Promise<HtmlRuntimeAssets>;
 /** Missing, malformed or digest-mismatched bytes never become executable responses. */
 read(digest:string):Promise<string|null>;
}
