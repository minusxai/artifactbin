/** The guide as an agent receives it, for tests: a skill-tree file rendered for `base`. */
import {renderSkill,skillTree,SKILL_MAIN_MAX_BYTES} from '@/lib/skills';

function renderDoc(docPath:string,base:string):string{
 const file=skillTree().get(docPath);
 if(!file)throw new Error(`No local skill file ${docPath}`);
 return renderSkill(file,{base});
}
export const QUICK_SHEET_MAX_BYTES=SKILL_MAIN_MAX_BYTES;
export function buildQuickSheet(base:string):string{return renderDoc('artifactbin/SKILL.md',base);}
/** The `lang` code blocks under `## heading` of a reference, rendered for `base`: what an agent copies. */
export function guideExamples(reference:string,heading:string,lang:string,base:string):string[]{
 const text=renderDoc(`artifactbin/references/${reference}.md`,base);
 const start=text.indexOf(`\n## ${heading}\n`);
 if(start<0)throw new Error(`${reference}.md has no section ${heading}`);
 const end=text.indexOf('\n## ',start+1);
 const section=text.slice(start,end<0?undefined:end);
 return [...section.matchAll(new RegExp('```'+lang+'\\n([\\s\\S]*?)```','g'))].map(match=>match[1]!);
}
