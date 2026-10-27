import {it,expect} from 'vitest';
it('defines strict commands, one registry entry per script',async()=>{
 const {COMMANDS,parseCommand}=await import('../../../skills/artifactbin/scripts/toolbox-commands.mjs');
 expect(Object.keys(COMMANDS)).toEqual(['auth','serve','autofix','publish','read','export','check','graphql','comment']);
 expect(()=>parseCommand('export',['PAGE12','--format','png','--viewport','390x844'])).toThrow();
 expect(()=>parseCommand('read',['PAGE12','--force'])).toThrow();
 expect(parseCommand('check',['PAGE12','--viewport','390x844','--viewport','1280x800']).values.viewport).toEqual(['390x844','1280x800']);
});
