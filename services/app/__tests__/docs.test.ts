/** The local bundle exposes current grammar without remote skill endpoints. */
import {expect,it} from 'vitest';
import teaching from '../../cli/src/generated/teaching.json';
import {STORY_HTML_TAGS,STORY_UI_COMPONENT_NAME_LIST} from '@/lib/story-ui/component-names';
import {OPERATIONS} from '@/lib/operations/registry';
it('the bundled vocabulary comes from the registries',()=>{
 const markup=teaching.files['references/markup.md'];
 expect(markup).toContain(`${STORY_HTML_TAGS.length} are allowed`);
 expect(markup).toContain(`Kit components (${STORY_UI_COMPONENT_NAME_LIST.length})`);
 for(const operation of OPERATIONS)expect(teaching.files['references/api.md']).toContain(`${operation.http.method} ${operation.http.path}`);
});
it('the bundled auth guide teaches local setup without self-minting or legacy configuration',()=>{
 const auth=teaching.files['references/publishing-auth.md'];
 expect(auth).toContain('~/.artifactbin/.env');expect(auth).toContain('afbin setup');
 expect(auth).not.toMatch(/tokens\/anonymous|MCP|~\/\.artifactbin\.env/);
});
