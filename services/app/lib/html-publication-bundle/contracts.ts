/** A bounded, explicit project snapshot. Local files and credentials never enter saved HTML. */
interface PublicationBundleFile { path:string; contentType:string; base64:string }
export interface PublicationBundleMapping { kind:'asset'|'dataset'; id:string; revision:string; state?:string; sha256?:string }
export interface PublicationBundle { entryPath:string; files:readonly PublicationBundleFile[]; mappings?:Readonly<Record<string,PublicationBundleMapping>> }
export interface BundleDependency { path:string; kind:'asset'|'dataset'; contentType:string; bytes:Uint8Array; dependencies:readonly string[] }
export interface BundlePlan { resolverSources:Readonly<Record<string,string>>; backends:readonly {name:string;path:string;bytes:number}[]; html:string; entryPath:string; dependencies:readonly BundleDependency[]; rewrite(source:string,containingPath:string,addresses:ReadonlyMap<string,string>):string }

/** Backend namespaces already supplied atomically or retained from trusted page metadata; how a bare save keeps links. */
export interface BundleResolutionContext { resolvedBackendNames?:readonly string[];
 /** A save that carries no project snapshot (bare HTML): a link to a file it does not hold stays as written. */
 linksAsWritten?:boolean }
/** Reverse only admitted scoped asset/dataset bindings; retain canonical node identities byte-for-byte. */
export interface AuthoringHtmlOptions {server:string;pageId:string;entryPath:string;receipts:readonly ({path:string}&PublicationBundleMapping)[]}
