/** The command registry is projected into the versioned local bundle; HTTP operations are not taught. */
import {expect,it} from 'vitest';
import {commands,commandHelp} from '../../../../cli/src/commands';
import teaching from '../../../../cli/src/generated/teaching.json';
it('documents every command and flag in local help without HTTP or remote-skill teaching',()=>{
 const reference=teaching.files['references/commands.md'];
 for(const command of commands)expect(reference,command.name).toContain(commandHelp(command.name));
 for(const [file,text] of Object.entries(teaching.files))expect(text,file).not.toMatch(/afbin api|--method|MCP|\/docs\/|api\.md|\/api\//);
 expect(Object.keys(teaching.files)).not.toContain('references/api.md');
});
