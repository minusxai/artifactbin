/** Editable account resources contain identifiers and settings, never bearer values. */
export interface ProfileResource {
 type:'profile';id?:string;state?:string;username?:string|null;email?:string;name?:string|null;
 liked?:string[];following?:string[];
}
export interface TokenResource {
 type:'token';id?:string;state?:string;name?:string|null;
 expires_at?:string|null;expires_in?:number;status?:'active'|'expired'|'revoked';
 created_at?:string;last_used_at?:string|null;
}
export interface SessionResource {
 type:'session';id?:string;state?:string;name?:string|null;harness?:string;machine?:string;cwd?:string;
 status?:'online'|'offline'|'exited';cols?:number;rows?:number;controller?:'local'|'web';created_at?:string;last_seen_at?:string|null;url?:string;
}
export const ACCOUNT_RESOURCE_TYPES=['profile','token','session'] as const;
export type AccountResource=ProfileResource|TokenResource|SessionResource;
