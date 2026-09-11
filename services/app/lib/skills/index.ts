/**
 * Build-only authoring sources. The skill folder (`skills/artifactbin/`) is
 * ONE co-located set: `SKILL.md` (the brief), `example.jsx` (the complete
 * commented document the brief inlines), `llms.txt` (the served one-pager for
 * an agent with nothing installed) and `references/*.md`. The CLI's teaching
 * compiler renders the brief and the references into its bundle; the server
 * reads `llms.txt` at runtime through lib/agent-discovery.
 */
import {buildSkillTree,loadSkillSources,type SkillTree} from './tree';
import {renderSkill} from './render';
import teaching from '../../../cli/src/generated/teaching.json';
export * from './tree';
export * from './render';
export * from './serve';
let cached:SkillTree|null=null;
export function skillTree():SkillTree{
 return cached??=buildSkillTree(loadSkillSources());
}
export function renderDoc(docPath:string,base:string):string{
 const file=skillTree().get(docPath);
 if(file)return renderSkill(file,{base});
 const bundled=(teaching.files as Record<string,string>)[docPath.replace(/^artifactbin\//,'')];
 if(bundled!==undefined)return bundled;
 throw new Error(`No local skill file ${docPath}`);
}
export const QUICK_SHEET_MAX_BYTES=8192;
export function buildQuickSheet(base:string):string{return renderDoc('artifactbin/SKILL.md',base);}
