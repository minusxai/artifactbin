/** Guides served over HTTP at /llms/TOPIC (for agents that call the API directly). */
const PUBLIC_TOPICS=new Set(['http-auth','runtime','html-operations','datasets','backends','dataviz','maps','diagrams']);
/** Served over HTTP only: the scripts' own descriptions cover them for agents using the downloaded skill. */
const SERVED_ONLY=new Set(['http-auth','html-operations']);
export function isPublicSkillTopic(topic:string):boolean{return PUBLIC_TOPICS.has(topic);}
/** The guides packed into the skill zip: every public one except those served only. */
export function isShippedSkillTopic(topic:string):boolean{return isPublicSkillTopic(topic)&&!SERVED_ONLY.has(topic);}
export function publicSkillLinks(text:string):string{return text;}
