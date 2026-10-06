/** Public reference rendering belongs to the app server: its registries read
 * app assets. Generic discovery is also used by the standalone CLI and must
 * stay independent of this renderer and the app's process.cwd asset contract. */
import {buildSkillTree,loadSkillSources,type SkillTree} from '../skills/tree';
import {renderSkill} from '../skills/render';
import {llmsSource} from './agent-discovery';
const BASE_TAG='[[ base ]]';
const origin=(base:string)=>base.replace(/\/$/,'');
let references:SkillTree|null=null;
// Older shared templates still name retired publishing references. Their endpoint
// contract now lives in http-api; keep the public reading path on that canonical guide.
const guideAliases:Record<string,string>={'publishing':'http-api','publishing-versions':'http-api','publishing-datasets':'http-api'};
/** Public references share the skill renderer and sources, without importing CLI teaching.
 * Lookup is confined to the flat references directory; user input never becomes an fs path. */
export function publicGuideText(topic:string,base:string):string|null{
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic))return null;
 const file=(references??=buildSkillTree(loadSkillSources())).get(`artifactbin/references/${topic}.md`);
 if(!file)return null;
 return renderSkill(file,{base:origin(base)}).replace(/\]\((?:references\/)?([a-z0-9-]+)\.md(#[^)\s]+)?\)/g,
  (_match,name:string,hash:string|undefined)=>`](${origin(base)}/llms/${guideAliases[name]??name}${hash??''})`);
}
/** Source preparation precedes the lower-level graph wire contract. */
export function llmsText(base:string):string{
 return llmsSource().split(BASE_TAG).join(origin(base))+'\n'
  +['http-api','http-authoring','http-document-graph'].map(topic=>publicGuideText(topic,base)).join('\n');
}
