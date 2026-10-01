/** Resolved mentions carry stable IDs. Plain @text and rendered User chips have no side effects. */
const ID='[A-Za-z0-9_-]{1,128}';
export function isPersonMentionHref(href:string):boolean{return new RegExp(`^/people/${ID}$`).test(href);}
export function personMentions(text:string):RegExpStringIterator<RegExpExecArray>{return text.matchAll(new RegExp(`\\[(@[a-z0-9_]+)\\]\\(/people/(${ID})\\)`,'gi'));}
export function personMention(person:{user_id:string;username:string}):string{return `[@${person.username}](/people/${person.user_id})`;}
