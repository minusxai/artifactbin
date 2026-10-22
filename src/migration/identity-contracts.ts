import type {MigrationMaps} from './contracts.ts';
export interface MigratedIdentity {
 legacyUserId:string;
 legacyTokenId?:string;
 actor:string|null;
 classification:'email-login'|'preserved-nonlogin'|'blocked';
 /** Nonlogin records preserve ownership/attribution only; no credential/access restoration. */
 reason:string;
}
export interface IdentityMigrationPlan {maps:MigrationMaps;identities:MigratedIdentity[]}
