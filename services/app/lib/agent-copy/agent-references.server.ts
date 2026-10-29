/** Public reference rendering for /llms.txt and /llms/<topic>. */
import {isPublicSkillTopic, buildSkillTree, loadSkillSources, type SkillTree, renderSkill, skillTree, projectSkillLinks} from '../skills';
const origin=(base:string)=>base.replace(/\/+$/,'');
let references:SkillTree|null=null;
/** Requests select only known skill topics; input never becomes a filesystem path. */
export function publicGuideText(topic:string,base:string):string|null{
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)||!isPublicSkillTopic(topic))return null;
 const file=(references??=buildSkillTree(loadSkillSources())).get(`artifactbin/references/${topic}.md`);
 return file?projectSkillLinks(file,renderSkill(file,{base:origin(base)}),origin(base)):null;
}
/** The shared root with HTTP procedures and request-origin links; no second manual. */
export function llmsText(base:string):string{
 const file=skillTree().get('artifactbin/SKILL.md')!;
 return projectSkillLinks(file,renderSkill(file,{base:origin(base)}),origin(base));
}
