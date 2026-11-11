import { personLinkPath } from '@artifactbin/contracts/url-space';
/**
 * Resolved mentions carry stable IDs. Plain @text and rendered User chips have no side effects. A mention is written
 * `[@name](/api/people/<id>)` (contracts `personLinkPath`); stored documents and comments keep the old form
 * `[@name](/people/<id>)`, which stays recognised everywhere (never rewritten) and still answers (legacy-public-paths).
 */
const ID='[A-Za-z0-9_-]{1,128}';
const HREF=`(?:/api)?/people/`;
export function isPersonMentionHref(href:string):boolean{return new RegExp(`^${HREF}${ID}$`).test(href);}
/** The user id a mention link names, in either form; null for anything else. */
export function personMentionId(href:string):string|null{return new RegExp(`^${HREF}(${ID})$`).exec(href)?.[1]??null;}
export function personMentions(text:string):RegExpStringIterator<RegExpExecArray>{return text.matchAll(new RegExp(`\\[(@[a-z0-9_]+)\\]\\(${HREF}(${ID})\\)`,'gi'));}
export function personMention(person:{user_id:string;username:string}):string{return `[@${person.username}](${personLinkPath(person.user_id)})`;}
