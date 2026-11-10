import {MINUSX_CONNECTION_KIND,type ResolverSecretHosts} from '@artifactbin/contracts';
import type {BackendChangeAuthority,BackendIdentityTransition} from './contracts';
/**
 * The declared names that hold a CREDENTIAL: every name but a governed MinusX binding (`'minusx'`), which stores only
 * `{connection_id, group_id}` and reads data as each viewer (lib/minusx), so it lends nobody's access to page code.
 */
export function credentialNames(backend:{secretBindings?:readonly string[];secretHosts?:ResolverSecretHosts}):string[]{
 return (backend.secretBindings??[]).filter(name=>backend.secretHosts?.[name]!==MINUSX_CONNECTION_KIND);
}
export function mayPublishBackendChange(authority:BackendChangeAuthority):boolean {
 return authority.personalOwner||!(authority.declaresSecrets||authority.historicalSecrets);
}
/** A new owner approves a new identity; state may be copied, credential rows never are. */
export function requiresFreshBackendIdentity(transition:BackendIdentityTransition):boolean {
 return transition.previousOwnerId!==transition.nextOwnerId;
}
