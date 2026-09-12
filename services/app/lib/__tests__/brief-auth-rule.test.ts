import { describe, expect, it } from 'vitest';
import { skillTree, SKILL_FILE_MAX_BYTES, renderTree } from '@/lib/skills';

const brief = renderTree(skillTree(), 'https://artifactbin.dev').find(({file}) => file.path === 'artifactbin/SKILL.md')!.text;
describe('the installed brief when authentication is missing', () => {
  it('teaches automatic sign-in, browser approval and the private configuration location, without a setup step', () => {
    expect(brief).not.toContain('afbin setup');
    expect(brief).toMatch(/automatic|authenticates itself|signs you in/i);
    expect(brief).toContain('~/.artifactbin/.env');
    expect(brief).toContain('browser approval');
    expect(brief).toContain('--yes');
    expect(brief).toMatch(/never.*mint/i);
    // MCP and /docs/ are banned here by agent-starter-consistency.test.ts's case (c),
    // which runs the whole retired vocabulary over every agent-facing surface.
  });
  it('fits the local skill budget', () => {
    expect(Buffer.byteLength(brief)).toBeLessThanOrEqual(SKILL_FILE_MAX_BYTES);
  });
});
