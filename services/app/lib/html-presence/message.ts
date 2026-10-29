import type {PresenceViewer} from './contract';
import {presenceGeometry} from './model';
/** A reader left (or hid): the room drops its entry. */
export interface PresenceDeparture { id: string; gone: true }
/** THE ONE WIRE FORMAT of a presence notification, written by the publisher and read by every room. */
export const encodePresenceMessage=(message:PresenceViewer|PresenceDeparture):string=>JSON.stringify(message);
/** A notification for this revision's room, or null: a foreign id, another revision or a malformed payload never enters a roster. */
export function decodePresenceMessage(payload:string,revision:string):PresenceViewer|PresenceDeparture|null{
 let raw:unknown;try{raw=JSON.parse(payload);}catch{return null;}
 if(!raw||typeof raw!=='object')return null;
 const entry=raw as Partial<PresenceViewer>&{gone?:unknown};
 if(typeof entry.id!=='string'||!/^[a-f0-9]{64}$/.test(entry.id))return null;
 if(entry.gone===true)return {id:entry.id,gone:true};
 if(entry.revision!==revision||typeof entry.label!=='string'||entry.label.length>100||typeof entry.seen!=='number'||!Number.isFinite(entry.seen))return null;
 return {id:entry.id,label:entry.label,revision,seen:entry.seen,...presenceGeometry(entry)};
}
