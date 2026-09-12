/** The local bundle exposes current grammar without remote skill endpoints. */
import {expect,it} from 'vitest';
import teaching from '../../cli/src/generated/teaching.json';
import {STORY_HTML_TAGS,STORY_UI_COMPONENT_NAME_LIST} from '@/lib/story-ui/component-names';
import {commands} from '../../cli/src/commands';
it('the bundled vocabulary comes from the registries',()=>{
 const markup=teaching.files['references/markup.md'];
 expect(markup).toContain(`${STORY_HTML_TAGS.length} are allowed`);
 expect(markup).toContain(`Kit components (${STORY_UI_COMPONENT_NAME_LIST.length})`);
 expect(Object.keys(teaching.files)).not.toContain('references/api.md');
 for(const command of commands)expect(teaching.files['references/commands.md']).toContain(`## ${command.name}\n`);
});
it('the bundled auth guide teaches local setup without self-minting or legacy configuration',()=>{
 const auth=teaching.files['references/publishing-auth.md'];
 expect(auth).toContain('~/.artifactbin/.env');expect(auth).toContain('afbin auth');
 expect(auth).not.toMatch(/tokens\/anonymous|MCP|~\/\.artifactbin\.env/);
});
