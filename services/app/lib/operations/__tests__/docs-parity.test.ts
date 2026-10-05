/** The command registry is projected into the versioned local bundle; HTTP integrations have their own email-authenticated reference. */
import {expect,it} from 'vitest';
import {commands,commandHelp} from '../../../../cli/src/commands';
import teaching from '../../../../cli/src/generated/teaching.json';
it('documents every command/flag and direct HTTP while refusing retired CLI and remote-skill transports',()=>{
 const reference=teaching.files['references/commands.md'];
 for(const command of commands)expect(reference,command.name).toContain(commandHelp(command.name));
 for(const [file,text] of Object.entries(teaching.files))expect(text,file).not.toMatch(/afbin api|--method|MCP|\/docs\/|references\/api\.md/);
 expect(Object.keys(teaching.files)).not.toContain('references/api.md');
 const http=teaching.files['references/http-api.md'];
 expect(http).toContain('/api/auth/email-otp/send-verification-otp');
 expect(http).toContain('/api/authentication/token');
 expect(http).toContain('Only verified email account sessions qualify');
 expect(http).toContain('http-authoring.md');
 expect(teaching.files['references/http-authoring.md']).toContain('function buildPlainTextUpdate');
 expect(teaching.files['references/http-document-graph.md']).toContain('patch.claims');
});
