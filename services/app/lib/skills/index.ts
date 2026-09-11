/** Build-only authoring sources. The CLI owns the skill root and generated command references. */
import {readFileSync} from 'node:fs';
import {buildSkillTree,loadSkillSources,type SkillTree} from './tree';
import {renderSkill} from './render';
import teaching from '../../../cli/src/generated/teaching.json';
export * from './tree';
export * from './render';
export * from './serve';
let cached:SkillTree|null=null;
export function skillTree():SkillTree{
 return cached??=buildSkillTree({...loadSkillSources(),'artifactbin/SKILL.md':readFileSync(new URL('../../../cli/skill/SKILL.md',import.meta.url),'utf8')});
}
export function renderDoc(path:string,base:string):string{
 const file=skillTree().get(path);
 if(file)return renderSkill(file,{base});
 const bundled=(teaching.files as Record<string,string>)[path.replace(/^artifactbin\//,'')];
 if(bundled!==undefined)return bundled;
 throw new Error(`No local skill file ${path}`);
}
export const QUICK_SHEET_MAX_BYTES=8192;
export function buildQuickSheet(base:string):string{return renderDoc('artifactbin/SKILL.md',base);}
