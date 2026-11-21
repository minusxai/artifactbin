import type {RemoteActivity,RemoteColor} from './remote';
/** Display names are labels, independent of handles. Empty or malformed labels carry no name. */
export function displayName(value: unknown): string | undefined {
 if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
 return value.trim() || undefined;
}

/** Editable account resources contain identifiers and settings, never bearer values. */
export interface ProfileResource {
 type:'profile';id?:string;state?:string;username?:string|null;email?:string;name?:string|null;
 liked?:string[];following?:string[];
}
interface SessionResource {
 managed?:boolean;activity?:RemoteActivity;color?:RemoteColor;
 type:'session';id?:string;state?:string;name?:string|null;harness?:string;machine?:string;cwd?:string;
 status?:'online'|'offline'|'exited';cols?:number;rows?:number;controller?:'local'|'web';created_at?:string;last_seen_at?:string|null;url?:string;
}
export type AccountResource=ProfileResource|SessionResource;
