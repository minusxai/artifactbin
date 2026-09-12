import {expect,it} from 'vitest';
import {agentContract} from '../agent-contract';
import {existingPaste} from '../agent-copy';
it('teaches local help, origin-scoped browser setup and the current private config directory',()=>{
 const contract=agentContract('https://example.test');
 expect(contract).toContain('afbin auth --server https://example.test');
 expect(contract).toContain('~/.artifactbin/.env');
 expect(contract).toContain('--yes --json');
 expect(contract).toContain('browser approval');
 // MCP and /docs/ are agent-starter-consistency.test.ts's ban, over every surface.
 expect(contract).not.toMatch(/plugin|~\/\.artifactbin\.env/);
});
it('the document handoff names afbin and nothing else',()=>{
 const text=existingPaste('https://example.test','abc123');
 expect(text).toContain('afbin');
 expect(text).not.toMatch(/MCP|\/docs\/|No local SDK or CLI/);
});
