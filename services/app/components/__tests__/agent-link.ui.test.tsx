/**
 * The one-click document button. Four things are guarded here:
 *
 * 1. The "copied" feedback is VISIBLE — the first version stored the message
 *    in state no JSX ever read, then navigated away the same tick, so the
 *    copy was silent and the reader had no idea the prompt was on their
 *    clipboard.
 * 2. Navigation waits a beat for that feedback to land. Pushing immediately
 *    is indistinguishable from the button not working.
 * 3. The beat is NARRATED, on the SAME ROW as the copy message: a silent
 *    three-second pause reads as a hang, and a page that then moves on its
 *    own reads as a page moving under the reader. Counting it down out loud
 *    makes the navigation something they were told about.
 * 4. Every surface behaves IDENTICALLY. The landing page used to opt out of
 *    the navigation entirely (a `reveal` prop), so the same button meant two
 *    different things depending on which page had drawn it — and the landing
 *    page carried BOTH shapes at once, hero and footer.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentLink from '@/components/AgentLink';
import GetStarted from '@/components/GetStarted';

const push = vi.fn();
vi.mock('@/lib/navigation', () => ({ useRouter: () => ({ push }) }));

const START = { id: 'abc123', url: '/a/abc123', token: 'mx_test', prompt: 'read this url' };

const theButton = () => screen.getByLabelText('Create a live document for my agent');

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(START) }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Click, then wait for the copy to be announced. Fake timers throughout. */
async function clickAndCopy() {
  fireEvent.click(theButton());
  await vi.waitFor(() => expect(screen.getByText(/copied/i)).toBeInTheDocument());
}

describe('<AgentLink>', () => {
  it('copies the prompt, SAYS so, counts the reader down, and only then navigates', async () => {
    vi.useFakeTimers();
    render(<AgentLink frame={false} />);
    await clickAndCopy();

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(START.prompt);
    // The two halves share one row: the countdown lives inside the button,
    // beside the message, rather than stacked under it.
    expect(theButton()).toHaveTextContent(/copied!\s*paste it in the agent/i);
    expect(theButton()).toHaveTextContent(/going to the artifact in 3/i);
    expect(push).not.toHaveBeenCalled();

    // Each tick lands inside a timer callback, so wait for React to commit it
    // rather than reading the tree in the same tick.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(theButton()).toHaveTextContent(/going to the artifact in 2/i));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(theButton()).toHaveTextContent(/going to the artifact in 1/i));
    expect(push).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(push).toHaveBeenCalledWith('/a/abc123');
  });

  it('counts down even when the clipboard refuses', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<AgentLink frame={false} />);
    fireEvent.click(theButton());
    // The fallback wording sends the reader to the document page for the
    // prompt, so taking them there is exactly right.
    await vi.waitFor(() => expect(screen.getByText(/copy the prompt from the document page/i)).toBeInTheDocument());
    expect(theButton()).toHaveTextContent(/going to the artifact in 3/i);
    await vi.advanceTimersByTimeAsync(3000);
    expect(push).toHaveBeenCalledWith('/a/abc123');
  });

  it('surfaces a failure instead of navigating, and counts down nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'rate_limited' }) }),
    );
    render(<AgentLink frame={false} />);
    fireEvent.click(theButton());
    await screen.findByText(/too many new documents/i);
    expect(screen.queryByText(/going to the artifact/i)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('does not mint a second document if the countdown is clicked', async () => {
    vi.useFakeTimers();
    render(<AgentLink frame={false} />);
    await clickAndCopy();
    fireEvent.click(theButton());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * The landing page renders this button through <GetStarted>, which is where
 * the divergence lived: it threaded a `reveal` prop that turned the
 * navigation off. Same click, same countdown, same destination.
 */
describe('the landing surface', () => {
  it('counts down and navigates exactly like every other surface', async () => {
    vi.useFakeTimers();
    render(<GetStarted />);
    await clickAndCopy();

    expect(theButton()).toHaveTextContent(/going to the artifact in 3/i);
    await vi.advanceTimersByTimeAsync(3000);
    expect(push).toHaveBeenCalledWith('/a/abc123');
  });
});
