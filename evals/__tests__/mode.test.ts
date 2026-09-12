import {expect,it} from 'vitest';
import {DEFAULT_MODE,cliPreinstalled,parseMode,planMode} from '../lib/mode';
it('runs two CLI flows, installed and not-installed, without silent substitutions',()=>{
 expect(DEFAULT_MODE).toBe('installed');
 for(const harness of ['claude-code','codex','pi','opencode'] as const)for(const mode of ['installed','not-installed'] as const)expect(planMode(harness,parseMode(mode))).toEqual({asked:mode,run:mode,substitutedWhy:null});
 expect(cliPreinstalled('installed')).toBe(true);expect(cliPreinstalled('not-installed')).toBe(false);
 for(const mode of ['cli','cold','fetched_skill+api_action','installed_skill+mcp_action'])expect(()=>parseMode(mode)).toThrow('unknown --mode');
});

import { vocabularyInstalled } from '../lib/mode';
it('the vocabulary is on disk in EVERY mode — the CLI stages or installs the skills — so read_docs_before_write never gates (run 34704052816 failed 12 of 13 on it)', () => {
  expect(vocabularyInstalled('installed')).toBe(true);
  expect(vocabularyInstalled('not-installed')).toBe(true);
});
