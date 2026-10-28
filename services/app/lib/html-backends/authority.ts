import type {BackendChangeAuthority,BackendIdentityTransition} from './contracts';
export function mayPublishBackendChange(authority:BackendChangeAuthority):boolean {
 return authority.personalOwner||!(authority.declaresSecrets||authority.historicalSecrets);
}
/** A new owner approves a new identity; state may be copied, credential rows never are. */
export function requiresFreshBackendIdentity(transition:BackendIdentityTransition):boolean {
 return transition.previousOwnerId!==transition.nextOwnerId;
}
