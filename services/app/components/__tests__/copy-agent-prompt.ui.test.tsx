/**
 * CopyAgentPrompt is the top-level document button that puts the "hand this
 * document to an agent" instruction on the clipboard. ONE door: POST
 * /api/my/artifacts/<id>/agent-prompt parks a fresh token in a one-time start
 * handle and returns the finished paste — a start LINK, never a credential.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyAgentPrompt from '@/components/CopyAgentPrompt';

const MINTED = { prompt: 'Help me edit my artifact. Follow instructions at http://localhost:3000/a/Ab3xK9/start?k=secret', url: 'http://localhost:3000/a/Ab3xK9' };

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/agent-prompt') && init?.method === 'POST') {
      return new Response(JSON.stringify(MINTED), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CopyAgentPrompt', () => {
  it('names the action in visible text and exposes copy feedback in the same place', async () => {
    render(<CopyAgentPrompt id="Ab3xK9" />);
    expect(screen.getByRole('button', { name: 'Copy agent instructions' })).toHaveTextContent('copy for agent');

    fireEvent.click(screen.getByRole('button', { name: 'Copy agent instructions' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy agent instructions' })).toHaveTextContent('copied'));
  });

  it('fetches the minted prompt and copies it', async () => {
    render(<CopyAgentPrompt id="Ab3xK9" />);
    fireEvent.click(screen.getByLabelText('Copy agent instructions'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MINTED.prompt));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/my/artifacts/Ab3xK9/agent-prompt', expect.objectContaining({ method: 'POST' }));
  });

  it('mints server-side even for an anonymous owner — the page holds no secret to inline', async () => {
    // This used to build the string in the browser from a localStorage token.
    // With the credential in an httpOnly cookie the page cannot read one, so
    // the server is the only place that can put a token in the paste-string —
    // and a leftover localStorage value must not tempt it back.
    localStorage.setItem('mx_tokens', JSON.stringify(['mx_held']));
    render(<CopyAgentPrompt id="Ab3xK9" />);
    fireEvent.click(screen.getByLabelText('Copy agent instructions'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(MINTED.prompt));
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]).not.toContain('mx_held');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/my/artifacts/Ab3xK9/agent-prompt', expect.objectContaining({ method: 'POST' }));
  });
});
