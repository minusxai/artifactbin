import {it,expect} from 'vitest';
it('defines strict commands, one registry entry per script',async()=>{
 const {COMMANDS,commandHelp,parseCommand}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 expect(Object.keys(COMMANDS)).toEqual(['auth','serve','autofix','publish','read','export','check','graphql','comment']);
 for(const name of Object.keys(COMMANDS))expect(commandHelp(name)).toContain('--help');
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
it('quotes every user-facing command in Core flows with flags and verbs its script description documents',async()=>{
 const {renderSkill,skillTree}=await import('@/lib/skills');
 const {COMMANDS:registry,describe,descriptionOf}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 const COMMANDS:Record<string,any>=registry;
 const skill=renderSkill(skillTree().get('artifactbin/SKILL.md')!,{base:'https://example.test',transport:'http'});
 const flows=skill.slice(skill.indexOf('## Core flows'),skill.indexOf('## Optional HTML components'));
 expect(flows.length).toBeGreaterThan(500);
 // Every command (the autofix helper included) appears in the flows, each as a real invocation.
 const calls=[...flows.matchAll(/node scripts\/(\w+)\.mjs([^`]*)`/g)];
 for(const name of Object.keys(COMMANDS))expect(calls.some(call=>call[1]===name),name).toBe(true);
 for(const [,name,rest] of calls){
  expect(COMMANDS[name!],name).toBeDefined();
  const description=descriptionOf(name!);
  // Flags used in the flows are documented by the script itself; so is a leading verb (list, reply, watch ...).
  for(const flag of rest!.match(/--[a-z-]+/g)??[])expect(description,`${name} ${flag}`).toContain(flag);
  const verb=rest!.trim().split(/\s+/)[0]!;
  if(COMMANDS[name!].sub&&Object.hasOwn(COMMANDS[name!].sub,verb))expect(description,`${name} ${verb}`).toContain(verb);
 }
 // The summary line of each command is the short description an agent sees at the top of its script.
 for(const name of Object.keys(COMMANDS))expect(describe(name).summary).toBe(descriptionOf(name).split('\n')[0]);
});
