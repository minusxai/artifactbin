import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AGENT_MARKS } from '@/components/GetStarted';
import NextSteps from '@/components/NextSteps';

describe('<NextSteps connectOnly>', () => {
  it('shows the known agent marks without the unrelated onboarding utilities', () => {
    render(<NextSteps connectOnly />);
    const connect = screen.getByLabelText('Connect an agent');
    expect(connect).toHaveAttribute('aria-expanded', 'false');
    expect(AGENT_MARKS.map((mark) => mark.key)).toEqual([
      'anthropic',
      'claude-code',
      'claude-ai',
      'openai',
      'codex',
      'pi',
      'opencode',
      'other',
    ]);
    expect(new Set(AGENT_MARKS.map((mark) => mark.icon)).size).toBe(AGENT_MARKS.length);
    expect(connect.querySelectorAll('svg')).toHaveLength(AGENT_MARKS.length + 1);
    expect(screen.queryByLabelText('Claim a token')).toBeNull();
    expect(screen.queryByLabelText('Add data')).toBeNull();
  });

  it('opens the two start paths in place, with the picker one fold deeper', () => {
    render(<NextSteps connectOnly />);
    fireEvent.click(screen.getByLabelText('Connect an agent'));
    // Path one needs no choice made first, so it is what unfolding shows.
    expect(screen.getByLabelText('Create a live document for my agent')).toBeTruthy();
    expect(screen.queryByLabelText('Agent families')).toBeNull();

    fireEvent.click(screen.getByLabelText('Install for my agent'));
    expect(screen.getByLabelText('Agent families')).toBeTruthy();
    expect(screen.getByLabelText('Agent surfaces')).toBeTruthy();
    expect(screen.getByLabelText('Use in Claude Code CLI')).toBeTruthy();
    expect(screen.queryByLabelText('Use in Codex CLI')).toBeNull();
  });
});
