/** Build-only projections; no HTTP skill serving or alternate action transports. */
import {renderSkill} from './render';
import {SKILL_FILE_NAME,resolveSkillLink,type SkillFile,type SkillTree} from './tree';
export function renderTree(tree:SkillTree,base:string):Array<{file:SkillFile;text:string}>{
 return tree.files.filter(file=>file.audience==='agent').map(file=>({file,text:renderSkill(file,{base})}));
}
export function skillFileWithFrontmatter(file:SkillFile,text:string):string{
 const fm=[`name: ${file.file===SKILL_FILE_NAME?file.name:JSON.stringify(file.name)}`,`description: ${JSON.stringify(file.description)}`].join('\n');
 return `---\n${fm}\n---\n${text}`;
}

/** Re-address every relative Markdown guide link, preserving anchors and queries. */
export function projectSkillLinks(file:SkillFile,text:string,base:string):string{
 return text.replace(/\]\(([^)\s]+)\)/g,(match,target:string)=>{
  const resolved=resolveSkillLink(file,target);
  if(!resolved||(!resolved.endsWith('.md')))return match;
  const suffix=target.match(/[?#].*$/)?.[0]??'';
  if(resolved==='artifactbin/SKILL.md')return `](${base}/llms.txt${suffix})`;
  return `](${base}/llms/${resolved.split('/').at(-1)!.replace(/\.md$/,'')}${suffix})`;
 });
}
