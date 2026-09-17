/** Build-only projections; no HTTP skill serving or alternate action transports. */
import {renderSkill} from './render';
import {SKILL_FILE_NAME,type SkillFile,type SkillTree} from './tree';
export function renderTree(tree:SkillTree,base:string):Array<{file:SkillFile;text:string}>{
 return tree.files.filter(file=>file.audience==='agent').map(file=>({file,text:renderSkill(file,{base})}));
}
export function skillFileWithFrontmatter(file:SkillFile,text:string):string{
 const fm=[`name: ${file.file===SKILL_FILE_NAME?file.name:JSON.stringify(file.name)}`,`description: ${JSON.stringify(file.description)}`].join('\n');
 return `---\n${fm}\n---\n${text}`;
}
