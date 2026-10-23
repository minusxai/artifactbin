import type {HtmlJson} from '@artifactbin/contracts';
export interface PreparedHtmlBackend {name:string;source:string;typeDefs:string;compiled:string;secretBindings?:string[]}
export interface HtmlBackendVersionRecord extends PreparedHtmlBackend {backendId:string;pageId:string;version:string;ownerId:string}
export interface HtmlBackendStoreValue {value:HtmlJson|null;version:number}
export interface HtmlBackendStoreWrite {ok:boolean;version:number}

/** Credential-bearing source changes require the current personal owner's approval. */
export interface BackendChangeAuthority {personalOwner:boolean;declaresSecrets:boolean;historicalSecrets:boolean}
export interface BackendIdentityTransition {previousOwnerId:string;nextOwnerId:string}

/** Immutable admitted backend identity, fenced again under the owning page lock at write commit. */
export interface HtmlBackendWriteScope {pageId:string;version:string;ownerId:string}
