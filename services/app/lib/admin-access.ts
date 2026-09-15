import {adminEmails} from './config';

/** Claims are supplied by the verified browser-session bridge, never request JSON. */
export interface VerifiedAccount {
 userId:string|null;
 email?:string|null;
 emailVerified?:boolean;
}

/** Deployment-owned editor access; it does not confer ownership. */
export function isDocumentAdmin(actor:VerifiedAccount):boolean {
 return !!actor.userId && actor.emailVerified===true && !!actor.email && adminEmails().has(actor.email.trim().toLowerCase());
}
