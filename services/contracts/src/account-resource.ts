/** Editable account resources contain identifiers and settings, never bearer values. */
export interface ProfileResource {
 type:'profile';id?:string;state?:string;username?:string|null;email?:string;name?:string|null;
 liked?:string[];following?:string[];
}
export interface SessionResource {
 type:'session';id?:string;state?:string;name?:string|null;harness?:string;machine?:string;cwd?:string;
 status?:'online'|'offline'|'exited';cols?:number;rows?:number;controller?:'local'|'web';created_at?:string;last_seen_at?:string|null;url?:string;
}
export const ACCOUNT_RESOURCE_TYPES=['profile','session'] as const;
export type AccountResource=ProfileResource|SessionResource;
