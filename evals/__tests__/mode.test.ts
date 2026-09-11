import {expect,it} from 'vitest';
import {DEFAULT_MODE,installsSkills,parseMode,planMode,providesConnection} from '../lib/mode';
it('runs two CLI treatments, installed and cold, without silent substitutions',()=>{
 expect(DEFAULT_MODE).toBe('installed');
 for(const harness of ['claude-code','codex','pi','opencode'] as const)for(const mode of ['installed','cold'] as const)expect(planMode(harness,parseMode(mode))).toEqual({asked:mode,run:mode,substitutedWhy:null});
 expect(installsSkills('installed')).toBe(true);expect(providesConnection('installed')).toBe(true);
 expect(installsSkills('cold')).toBe(false);expect(providesConnection('cold')).toBe(false);
 for(const mode of ['cli','fetched_skill+api_action','installed_skill+mcp_action'])expect(()=>parseMode(mode)).toThrow('unknown --mode');
});
