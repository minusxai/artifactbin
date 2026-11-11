import type {DatasetRole,ResolverSecretHosts} from '@artifactbin/contracts';
/**
 * `functions`: a typeDefs-free file's callable functions and their roles (typeDefs ''); null or absent for a legacy file.
 * `schedule`: such a file's scheduled functions, `{name: intervalMs}`; null or absent without one.
 */
export interface PreparedHtmlBackend {name:string;source:string;typeDefs:string;functions?:Readonly<Record<string,DatasetRole>>|null;schedule?:Readonly<Record<string,number>>|null;compiled:string;secretBindings?:string[];secretHosts?:ResolverSecretHosts}
export interface HtmlBackendVersionRecord extends PreparedHtmlBackend {backendId:string;pageId:string;version:string;ownerId:string}

/**
 * Credential-bearing source changes require the current personal owner's approval. `declaresSecrets` and
 * `historicalSecrets` count credentials only (./authority `credentialNames`): a viewer binding is not one, so a
 * group-owned page may carry it.
 */
export interface BackendChangeAuthority {personalOwner:boolean;declaresSecrets:boolean;historicalSecrets:boolean}
export interface BackendIdentityTransition {previousOwnerId:string;nextOwnerId:string}
