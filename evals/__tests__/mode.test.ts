import {expect,it} from 'vitest';
import {DEFAULT_MODE,parseMode,planMode} from '../lib/mode';
it('runs one CLI/local-skill treatment without silent transport substitutions',()=>{
 expect(DEFAULT_MODE).toBe('cli');
 for(const harness of ['claude-code','codex','pi','opencode'] as const)expect(planMode(harness,parseMode('cli'))).toEqual({asked:'cli',run:'cli',substitutedWhy:null});
 for(const mode of ['fetched_skill+api_action','installed_skill+mcp_action'])expect(()=>parseMode(mode)).toThrow('unknown --mode');
});
