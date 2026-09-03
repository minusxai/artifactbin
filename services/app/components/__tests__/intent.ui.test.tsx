/**
 * `?intent=` — the one-shot instruction a door leaves on the way back in.
 *
 * Two journeys leave a document and have to come back to it DOING the thing
 * that was asked: "fork this" (which needs an account) and "log in to comment"
 * (which needs one too). Without this the person returns to a document that
 * has forgotten what they pressed, and does the work twice.
 *
 * Four properties, and each of them is a way this could go wrong:
 *  - a STRICT ALLOWLIST. It rides on a SHARED link, so anybody may append
 *    anything; `?intent=delete` must be silence, not an error and certainly
 *    not an act.
 *  - a fork ASKS. It writes into someone's account, and the address that asked
 *    for it is one anyone could have handed over.
 *  - it is consumed ONCE and stripped, so a refresh does not re-prompt.
 *  - stripping keeps the rest of the address exactly as it was: the `$` values
 *    of F2 live in this same query string and are the reader's document.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readIntent, stripIntent, withIntent } from '@/lib/intent';

const layerProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/AnnotationLayer', () => ({
  default: (props: Record<string, unknown>) => { layerProps.push(props); return null; },
}));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const ok201 = { ok: true, status: 201, json: async () => ({ id: 'copy01', url: 'http://localhost:3000/@me/copy01-doc' }) };

beforeEach(() => {
  layerProps.length = 0;
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async () => ok201) as unknown as typeof fetch);
  window.history.replaceState(null, '', '/a/story1');
});
afterEach(() => { vi.unstubAllGlobals(); });

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1', editId: 'edit_1', format: 'markup', title: 'Quarterly report', source: null, template: null,
  refs: [], version: 1, content: '', columns: [], compiledCss: null, theme: null, colorMode: null,
  ...over,
});

/** The address the page really has, and the `search` prop the router feeds it — both. */
const at = (url: string, over: Partial<ArtifactSurfaceProps> = {}, role: 'owner' | 'editor' | 'commenter' = 'owner') => {
  window.history.replaceState(null, '', url);
  const search = new URL(url, 'http://localhost:3000').search;
  return render(
    <ArtifactShell role={role}>
      <ArtifactSurface {...props({ search, ...over })} />
    </ArtifactShell>,
  );
};

describe('the allowlist is the whole parser', () => {
  it('names only what the page is designed to be asked', () => {
    expect(readIntent('?intent=fork')).toBe('fork');
    expect(readIntent('?intent=comment')).toBe('comment');
    for (const hostile of ['?intent=delete', '?intent=', '?intent=FORK', '?', '', '?$region=west']) {
      expect(readIntent(hostile), hostile).toBeNull();
    }
  });

  it('strips only itself, byte for byte, and can be written back on', () => {
    expect(stripIntent('?intent=fork&$region=west')).toBe('?$region=west');
    // Never re-encoded: `$` and a space survive exactly as the link carried them.
    expect(stripIntent('?%24team=LA+Lakers&intent=comment')).toBe('?%24team=LA+Lakers');
    expect(stripIntent('?intent=fork')).toBe('');
    expect(stripIntent('?$a=1')).toBe('?$a=1');
    expect(withIntent('?$region=west', 'fork')).toBe('?$region=west&intent=fork');
    expect(withIntent('', 'comment')).toBe('?intent=comment');
    // Asking twice is asking once.
    expect(withIntent('?intent=comment', 'fork')).toBe('?intent=fork');
  });
});

describe('?intent=fork asks before it writes', () => {
  it('opens the confirm, names the document, and forks on confirm', async () => {
    at('/a/story1?intent=fork');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Quarterly report');

    fireEvent.click(screen.getByLabelText('Confirm fork'));
    await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/my/artifacts/story1/fork'));
  });

  it('cancel closes it and forks nothing', async () => {
    at('/a/story1?intent=fork');
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText('Cancel fork'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('Escape cancels it too, and the confirm holds focus', async () => {
    at('/a/story1?intent=fork');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('?intent=comment opens the conversation', () => {
  it('is the comments row and nothing more — no mode, no hash', async () => {
    at('/a/story1?intent=comment', {}, 'commenter');
    await waitFor(() => expect(layerProps.at(-1)).toMatchObject({ railOpen: true }));
    expect(window.location.hash).toBe('');
  });
});

describe('anything else is silence', () => {
  it('ignores an intent the page was never designed to be asked', async () => {
    at('/a/story1?intent=delete');
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(layerProps.at(-1) ?? { railOpen: false }).toMatchObject({ railOpen: false });
  });
});

describe('the instruction is consumed, and only it', () => {
  it('leaves the reader\'s own selection and their place in the document alone', async () => {
    at('/a/story1?intent=fork&$region=west#section-3');
    await screen.findByRole('dialog');
    await waitFor(() => expect(window.location.search).toBe('?$region=west'));
    expect(window.location.hash).toBe('#section-3');
    expect(window.location.pathname).toBe('/a/story1');
  });

  it('takes the whole query away when the intent was all of it', async () => {
    at('/a/story1?intent=comment', {}, 'commenter');
    await waitFor(() => expect(window.location.search).toBe(''));
  });
});
