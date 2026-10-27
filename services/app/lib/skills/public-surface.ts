/** Only native authoring guides are part of the public HTTP skill. */
const PUBLIC_TOPICS=new Set(['http-auth','html-authoring','html-runtime','html-operations','html-datasets','html-backends','html-design-systems','dataviz','maps','diagrams']);
export function isPublicSkillTopic(topic:string):boolean{return PUBLIC_TOPICS.has(topic)||/^html-system-[a-z0-9-]+$/.test(topic);}
export function publicSkillLinks(text:string):string{return text;}
