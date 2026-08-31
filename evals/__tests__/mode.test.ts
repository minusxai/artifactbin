/** The mode is the cross-product of skill delivery and action transport. */
import { describe, it, expect } from 'vitest';
import {
  EVAL_MODES, DEFAULT_MODE, actionTransport, connectsMcp, fetchesSkills, installsSkills,
  parseMode, planMode, planTransport, skillSource,
} from '../lib/mode';

describe('parseMode', () => {
  it('accepts exactly the four real treatments', () => {
    expect(EVAL_MODES).toEqual(['fetched_skill+api_action', 'fetched_skill+mcp_action', 'installed_skill+api_action', 'installed_skill+mcp_action']);
    for (const mode of EVAL_MODES) expect(parseMode(mode)).toBe(mode);
    expect(() => parseMode('plugins')).toThrow(/fetched_skill\+api_action.*installed_skill\+mcp_action/);
  });

  it('defaults to HTTP-served skills and API actions', () => {
    expect(DEFAULT_MODE).toBe('fetched_skill+api_action');
  });
});

describe('the two axes', () => {
  it('reads the skill source independently of the action transport', () => {
    expect(EVAL_MODES.map(skillSource)).toEqual(['fetched_skill', 'fetched_skill', 'installed_skill', 'installed_skill']);
    expect(EVAL_MODES.filter(fetchesSkills)).toEqual(['fetched_skill+api_action', 'fetched_skill+mcp_action']);
    expect(EVAL_MODES.filter(installsSkills)).toEqual(['installed_skill+api_action', 'installed_skill+mcp_action']);
  });

  it('reads the action transport independently of skill delivery', () => {
    expect(EVAL_MODES.map(actionTransport)).toEqual(['api', 'mcp', 'api', 'mcp']);
    expect(EVAL_MODES.filter(connectsMcp)).toEqual(['fetched_skill+mcp_action', 'installed_skill+mcp_action']);
  });
});

describe('planMode', () => {
  it('runs every requested mode unchanged where the harness supports MCP', () => {
    for (const harness of ['claude-code', 'codex', 'opencode'] as const) {
      for (const mode of EVAL_MODES) {
        expect(planMode(harness, mode)).toEqual({ asked: mode, run: mode, substitutedWhy: null });
      }
    }
  });

  it('Pi preserves skill delivery when it substitutes API actions for MCP', () => {
    expect(planMode('pi', 'fetched_skill+mcp_action')).toMatchObject({ asked: 'fetched_skill+mcp_action', run: 'fetched_skill+api_action' });
    expect(planMode('pi', 'installed_skill+mcp_action')).toMatchObject({ asked: 'installed_skill+mcp_action', run: 'installed_skill+api_action' });
    expect(planMode('pi', 'installed_skill+mcp_action').substitutedWhy).toMatch(/no MCP client/);
  });
});

describe('planTransport', () => {
  it('keeps API actions for every harness', () => {
    for (const harness of ['claude-code', 'codex', 'pi', 'opencode'] as const) {
      expect(planTransport(harness, 'api')).toEqual({ asked: 'api', run: 'api', substitutedWhy: null });
    }
  });

  it('substitutes API actions only when Pi is directly asked for MCP', () => {
    expect(planTransport('codex', 'mcp')).toEqual({ asked: 'mcp', run: 'mcp', substitutedWhy: null });
    expect(planTransport('pi', 'mcp')).toMatchObject({ asked: 'mcp', run: 'api' });
  });
});
