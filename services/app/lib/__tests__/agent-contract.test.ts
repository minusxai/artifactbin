import {expect,it} from 'vitest';
import {agentContract} from '../agent-contract';
import {existingPaste} from '../agent-copy';
import {startBrief} from '../start-links';
it('teaches local help, origin-scoped browser setup and the current private config directory',()=>{
 const contract=agentContract('https://example.test');
 expect(contract).toContain('afbin setup --server https://example.test');
 expect(contract).toContain('~/.artifactbin/.env');
 expect(contract).toContain('--yes --json');
 expect(contract).toContain('browser approval');
 expect(contract).not.toMatch(/MCP|plugin|~\/\.artifactbin\.env|\/docs\//);
});
it('document handoff and one-use links teach pull, edit, validate and push with local references',()=>{
 for(const text of [existingPaste('https://example.test','abc123'),startBrief('https://example.test','abc123','one-use')]){
  expect(text).toContain('afbin');expect(text).not.toMatch(/MCP|\/docs\/|No local SDK or CLI/);
 }
 const brief=startBrief('https://example.test','abc123','one-use');
 expect(brief).toContain('curl -X POST');
 expect(brief).toContain('afbin pull');expect(brief).toContain('afbin validate');expect(brief).toContain('afbin push');
});
