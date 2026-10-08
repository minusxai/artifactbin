/**
 * The guide as an agent receives it, for tests: a skill-tree file rendered for `base`, else the CLI's
 * compiled teaching (services/cli/src/generated/teaching.json), which also carries the references the
 * CLI generates from its own registries. Test-only: product code serves the skill tree (lib/skills)
 * and never reads the CLI's build output.
 */
import {renderSkill,skillTree} from '@/lib/skills';
import teaching from '../../../cli/src/generated/teaching.json';

export function renderDoc(docPath:string,base:string):string{
 const file=skillTree().get(docPath);
 if(file)return renderSkill(file,{base});
 const bundled=(teaching.files as Record<string,string>)[docPath.replace(/^artifactbin\//,'')];
 if(bundled!==undefined)return bundled;
 throw new Error(`No local skill file ${docPath}`);
}
export const QUICK_SHEET_MAX_BYTES=8192;
export function buildQuickSheet(base:string):string{return renderDoc('artifactbin/SKILL.md',base);}
