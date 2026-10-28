/** The guide as an agent receives it, for tests: a skill-tree file rendered for `base`. */
import {renderSkill,skillTree,SKILL_MAIN_MAX_BYTES} from '@/lib/skills';

function renderDoc(docPath:string,base:string):string{
 const file=skillTree().get(docPath);
 if(!file)throw new Error(`No local skill file ${docPath}`);
 return renderSkill(file,{base});
}
export const QUICK_SHEET_MAX_BYTES=SKILL_MAIN_MAX_BYTES;
export function buildQuickSheet(base:string):string{return renderDoc('artifactbin/SKILL.md',base);}
