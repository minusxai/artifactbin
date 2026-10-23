/** Internal compatibility teaching is not part of the public HTTP author skill. */
const RETIRED_TOPICS:Record<string,string>={
 'npm-local':'http-auth','publishing-auth':'http-auth',commands:'http-api',
 'remote-review':'monitoring',markdown:'http-authoring',
};
export function isPublicSkillTopic(topic:string):boolean{return !Object.hasOwn(RETIRED_TOPICS,topic);}
/** Preserve working relative links when a shared source mentions a retired command guide. */
export function publicSkillLinks(text:string):string{
 return text.replace(/\]\(((?:references\/)?)([a-z0-9-]+)\.md([?#][^)]*)?\)/g,(match,prefix:string,topic:string,suffix:string|undefined)=>{
  const replacement=RETIRED_TOPICS[topic];return replacement?`](${prefix}${replacement}.md${suffix??''})`:match;
 });
}
