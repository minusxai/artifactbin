import type {DatasetRole,ResolverSecretHosts} from '@artifactbin/contracts';
/** `functions`: a typeDefs-free file's callable functions and their roles (typeDefs ''); null or absent for a legacy file. */
export interface PreparedHtmlBackend {name:string;source:string;typeDefs:string;functions?:Readonly<Record<string,DatasetRole>>|null;compiled:string;secretBindings?:string[];secretHosts?:ResolverSecretHosts}
export interface HtmlBackendVersionRecord extends PreparedHtmlBackend {backendId:string;pageId:string;version:string;ownerId:string}

/** Credential-bearing source changes require the current personal owner's approval. */
export interface BackendChangeAuthority {personalOwner:boolean;declaresSecrets:boolean;historicalSecrets:boolean}
export interface BackendIdentityTransition {previousOwnerId:string;nextOwnerId:string}
