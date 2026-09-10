import {expect,it} from 'vitest';
import {buildPluginFiles} from '../plugin-package';
import teaching from '../../../cli/src/generated/teaching.json';
it('packages the released local CLI skill with no server registration or remote reference tree',()=>{
 const files=buildPluginFiles('https://self.example');
 expect(files['.mcp.json']).toBeUndefined();
 expect(JSON.parse(files['.codex-plugin/plugin.json'])).not.toHaveProperty('mcpServers');
 expect(files['skills/artifactbin/SKILL.md']).toBe(teaching.files['SKILL.md']);
 expect(files['README.md']).toContain('afbin setup --server https://self.example');
 expect(Object.values(files).join('\n')).not.toMatch(/\/mcp|\/docs\//);
});
