import {createHash} from 'node:crypto';
import type {PresenceIdentity,PresenceViewer} from './contract';
import {encodePresenceMessage} from './message';
import {PRESENCE_GUEST_LABEL,presenceGeometry} from './model';
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
export async function publishPresence(actor:PresenceAuthor,row:{version:number},input:unknown,ports:PresencePublisherPorts):Promise<PresenceIdentity|null>{
 const raw=input&&typeof input==='object'?input as Record<string,unknown>:null;
 const revision=String(row.version);
 if(!raw||typeof raw.session!=='string'||!/^[a-f0-9-]{36}$/.test(raw.session)||typeof raw.revision!=='string')return null;
 // A page still showing an older version (it draws the new one in place, solid/document follow-html-version) is not
 // wrong, only behind: its report is dropped, and it reports again on the version it draws. A future revision is.
 const behind=/^[1-9][0-9]*$/.test(raw.revision)&&Number(raw.revision)<row.version;
 if(raw.revision!==revision&&!behind)return null;
 const id=createHash('sha256').update(`${actor.userId??actor.tokenId??'guest'}:${raw.session}`).digest('hex');
 const colorId=presenceAccountIdentity(actor.userId)??id;
 if(behind)return {id,colorId};
 if(raw.visible===false){await ports.notify(encodePresenceMessage({id,gone:true}));return {id,colorId};}
 const entry:PresenceViewer={id,colorId,label:await ports.label(actor.userId)??PRESENCE_GUEST_LABEL,revision,seen:ports.now(),...presenceGeometry(raw)};
 await ports.notify(encodePresenceMessage(entry));
 return {id,colorId};
}

/** Same opaque identity for authenticated publication and authorized room personalization. */
export const presenceAccountIdentity=(userId:string|null):string|undefined=>userId?createHash('sha256').update(`presence-color:account:${userId}`).digest('hex'):undefined;
