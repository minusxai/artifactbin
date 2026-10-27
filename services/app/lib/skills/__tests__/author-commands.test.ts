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
