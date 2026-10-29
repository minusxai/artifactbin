import {createHash} from 'node:crypto';
import type {PresenceViewer} from './contract';
import {encodePresenceMessage} from './message';
import {presenceGeometry} from './model';
/** Who is publishing, as the platform resolved them; never anything the page supplied. */
export interface PresenceAuthor { userId: string | null; tokenId?: string | null }
export interface PresencePublisherPorts {
 /** The account's public handle, or null for a guest. */
 label(userId:string|null):Promise<string|null>;
 notify(message:string):Promise<void>;
 now():number;
}
/**
 * One reader's heartbeat or geometry, published to the document's presence rooms. A per-tab random secret becomes a
 * public, non-reversible roster id; the label and revision come from the platform. Null: the input is not a presence
 * publication for this revision.
 */
export async function publishPresence(actor:PresenceAuthor,row:{version:number},input:unknown,ports:PresencePublisherPorts):Promise<{id:string}|null>{
 const raw=input&&typeof input==='object'?input as Record<string,unknown>:null;
 const revision=String(row.version);
 if(!raw||typeof raw.session!=='string'||!/^[a-f0-9-]{36}$/.test(raw.session)||raw.revision!==revision)return null;
 const id=createHash('sha256').update(`${actor.userId??actor.tokenId??'guest'}:${raw.session}`).digest('hex');
 if(raw.visible===false){await ports.notify(encodePresenceMessage({id,gone:true}));return {id};}
 const entry:PresenceViewer={id,label:await ports.label(actor.userId)??'Guest',revision,seen:ports.now(),...presenceGeometry(raw)};
 await ports.notify(encodePresenceMessage(entry));
 return {id};
}
