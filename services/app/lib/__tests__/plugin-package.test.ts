/** Optional local plugin packaging uses the exact released CLI bundle. */
import {expect,it} from 'vitest';
import {buildPluginFiles,buildMirrorFiles,PLUGIN_NAME,MARKETPLACE_NAME,PLUGIN_VERSION} from '../plugin-package';
import teaching from '../../../cli/src/generated/teaching.json';
it('ships every local file byte for byte with consistent manifests and no server registration',()=>{
 const files=buildPluginFiles();
 for(const [name,text] of Object.entries(teaching.files))expect(files[`skills/artifactbin/${name}`]).toBe(text);
 for(const manifest of ['.claude-plugin/plugin.json','.codex-plugin/plugin.json'])expect(JSON.parse(files[manifest])).toMatchObject({name:PLUGIN_NAME,version:PLUGIN_VERSION});
 expect(files['.mcp.json']).toBeUndefined();
 expect(JSON.parse(files['.codex-plugin/plugin.json'])).not.toHaveProperty('mcpServers');
});
it('materializes the same plugin under the marketplace with source provenance',()=>{
 const mirror=buildMirrorFiles();
 for(const [name,text] of Object.entries(buildPluginFiles()))expect(mirror[`plugins/${PLUGIN_NAME}/${name}`]).toBe(text);
 expect(JSON.parse(mirror['.claude-plugin/marketplace.json'])).toMatchObject({name:MARKETPLACE_NAME,plugins:[{name:PLUGIN_NAME,source:`./plugins/${PLUGIN_NAME}`}]});
 expect(JSON.parse(mirror['.artifactbin-release.json'])).toMatchObject({sourceRepository:'minusxai/artifactbin',sourceSha:'development',version:PLUGIN_VERSION});
});
