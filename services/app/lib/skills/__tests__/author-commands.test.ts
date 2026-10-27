import {it,expect} from 'vitest';
it('defines strict commands and a generated table of the eight discoverable ones',async()=>{
 const {COMMANDS,commandHelp,commandTable,parseCommand}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 expect(Object.keys(COMMANDS)).toEqual(['auth','serve','autofix','publish','read','export','check','graphql','comment']);
 for(const name of Object.keys(COMMANDS))expect(commandHelp(name)).toContain('--help');
 // publish and serve run autofix themselves; SKILL.md names autofix.mjs in one line instead of a table row.
 for(const name of ['auth','serve','publish','read','export','check','graphql','comment'])expect(commandTable()).toContain(name+'.mjs');
 expect(commandTable()).not.toContain('autofix.mjs');
 expect(()=>parseCommand('export',['PAGE12','--format','png','--viewport','390x844'])).toThrow();
 expect(()=>parseCommand('read',['PAGE12','--force'])).toThrow();
 expect(parseCommand('check',['PAGE12','--viewport','390x844','--viewport','1280x800']).values.viewport).toEqual(['390x844','1280x800']);
});
const scripts=new URL('../../../skills/artifactbin/scripts/',import.meta.url);
it('keeps one DESCRIPTION per command at the very top of its script, and --help prints exactly that',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {COMMANDS:registry,commandHelp,descriptionOf,describe}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 const COMMANDS:Record<string,any>=registry;
 for(const name of Object.keys(COMMANDS)){
  const source=await readFile(new URL(`${name}.mjs`,scripts),'utf8');
  // A comment, then the export, before any import: an agent running head sees it.
  expect(source.indexOf('export const DESCRIPTION'),name).toBeLessThan(source.indexOf('import '));
  expect(source.split('\n')[0],name).toMatch(/^\/\*\*? .*\*\/$|^\/\//);
  const module=await import(`../../../skills/artifactbin/scripts/${name}.mjs`);
  expect(module.DESCRIPTION,name).toBe(descriptionOf(name));
  expect(commandHelp(name)).toBe(module.DESCRIPTION+'\n');
  expect(describe(name).summary.length,name).toBeGreaterThan(10);
  // Every flag the parser accepts is explained where the reader looks.
  const flags=[...Object.keys(COMMANDS[name].flags??{}),...(Object.values(COMMANDS[name].sub??{}) as object[]).flatMap(group=>Object.keys(group))];
  for(const flag of flags)expect(module.DESCRIPTION,`${name} --${flag}`).toContain('--'+flag);
 }
});
it('generates the SKILL.md command table from each script description',async()=>{
 const {renderSkill,skillTree}=await import('@/lib/skills');
 const {COMMANDS,describe}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 const skill=renderSkill(skillTree().get('artifactbin/SKILL.md')!,{base:'https://example.test',transport:'http'});
 for(const [name,spec] of Object.entries<any>(COMMANDS)){
  const {summary,example}=describe(name);
  if(spec.listed===false){expect(skill).not.toContain(`| \`${example}\``);continue;}
  expect(skill,name).toContain(summary);expect(skill,name).toContain('`'+example+'`');
 }
});
