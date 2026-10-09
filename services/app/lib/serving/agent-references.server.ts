/** Public reference rendering belongs to the app server: its registries read
 * app assets. Generic discovery is also used by the standalone CLI and must
 * stay independent of this renderer and the app's process.cwd asset contract. */
import {buildSkillTree,loadSkillSources,type SkillTree} from '../skills/tree';
import {renderSkill} from '../skills/render';
import {skillTree} from '../skills';
import {projectSkillLinks} from '../skills/serve';
const origin=(base:string)=>base.replace(/\/+$/,'');
let references:SkillTree|null=null;
/** Requests select only known skill topics; input never becomes a filesystem path. */
export function publicGuideText(topic:string,base:string):string|null{
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic))return null;
 const file=(references??=buildSkillTree(loadSkillSources())).get(`artifactbin/references/${topic}.md`);
 return file?projectSkillLinks(file,renderSkill(file,{base:origin(base)}),origin(base)):null;
}
/** The installed root, projected onto the request's origin, with no second manual. */
export function llmsText(base:string):string{
 const file=skillTree().get('artifactbin/SKILL.md')!;
 return projectSkillLinks(file,renderSkill(file,{base:origin(base)}),origin(base));
}
