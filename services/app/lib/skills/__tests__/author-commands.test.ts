import {it,expect} from 'vitest';
it('defines eight strict discoverable commands and a matching generated table',async()=>{
 const {COMMANDS,commandHelp,commandTable,parseCommand}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 expect(Object.keys(COMMANDS)).toEqual(['auth','serve','publish','read','export','check','graphql','comment']);
 for(const name of Object.keys(COMMANDS)){expect(commandHelp(name)).toContain('--help');expect(commandTable()).toContain(name+'.mjs');}
 expect(()=>parseCommand('export',['PAGE12','--format','png','--viewport','390x844'])).toThrow();
 expect(()=>parseCommand('read',['PAGE12','--force'])).toThrow();
 expect(parseCommand('check',['PAGE12','--viewport','390x844','--viewport','1280x800']).values.viewport).toEqual(['390x844','1280x800']);
});
