/** Guides served over HTTP at /llms/TOPIC (for agents that call the API directly). */
const PUBLIC_TOPICS=new Set(['http-auth','runtime','html-operations','datasets','permissions','resolvers','dataviz','maps','diagrams','groups']);
/** Retired topic names still served, as the text of the guide that replaced them (installed skills lag). */
const TOPIC_ALIASES:Readonly<Record<string,string>>={backends:'resolvers'};
/** The guide a served topic reads: itself, or the guide an alias names. */
export function publicSkillTopicFile(topic:string):string{return Object.hasOwn(TOPIC_ALIASES,topic)?TOPIC_ALIASES[topic]!:topic;}
/** Served over HTTP only: the scripts' own descriptions cover them for agents using the downloaded skill. */
const SERVED_ONLY=new Set(['http-auth','html-operations']);
export function isPublicSkillTopic(topic:string):boolean{return PUBLIC_TOPICS.has(publicSkillTopicFile(topic));}
/** The guides packed into the skill zip: every public one except those served only. */
export function isShippedSkillTopic(topic:string):boolean{return isPublicSkillTopic(topic)&&!SERVED_ONLY.has(topic);}
