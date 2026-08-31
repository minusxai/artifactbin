/**
 * The one-click document button. Two things are guarded here:
 *
 * 1. The "copied" feedback is VISIBLE — the first version stored the message
 *    in state no JSX ever read, then navigated away the same tick, so the
 *    copy was silent and the reader had no idea the prompt was on their
 *    clipboard.
 * 2. Navigation waits a beat for that feedback to land. Pushing immediately
 *    is indistinguishable from the button not working.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentLink from '@/components/AgentLink';

const push = vi.fn();
vi.mock('@/lib/navigation', () => ({ useRouter: () => ({ push }) }));

const START = { id: 'abc123', url: '/a/abc123', token: 'mx_test', prompt: 'read this url' };

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(START) }));
});
afterEach(() => vi.unstubAllGlobals());

describe('<AgentLink>', () => {
  it('copies the prompt, SAYS so on the button, and only then navigates', async () => {
    render(<AgentLink frame={false} />);
    fireEvent.click(screen.getByLabelText('Create a live document for my agent'));

    // The feedback beat: the copy is announced before the page changes.
    await screen.findByText(/copied/i);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(START.prompt);
    expect(push).not.toHaveBeenCalled();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/a/abc123'), { timeout: 3000 });
  });

  it('surfaces a failure instead of navigating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'rate_limited' }) }),
    );
    render(<AgentLink frame={false} />);
    fireEvent.click(screen.getByLabelText('Create a live document for my agent'));
    await screen.findByText(/too many new documents/i);
    expect(push).not.toHaveBeenCalled();
  });
});
