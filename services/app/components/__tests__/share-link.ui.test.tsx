/**
 * ShareLink is ONE button: for a session owner it opens the sharing dialog
 * (copy link + visibility + invited emails, all in one surface); for
 * everyone else it is the plain one-click copy button — an anonymous
 * artifact has no ACL to manage. All ACL traffic goes through
 * /api/my/artifacts/<id>/sharing (session-only surface).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShareLink from '@/components/ShareLink';

const sharingState = { visibility: 'private', shares: [] as Array<{ email: string; role: string }> };

beforeEach(() => {
  sharingState.visibility = 'private';
  sharingState.shares = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.endsWith('/sharing')) {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        if (body.visibility) sharingState.visibility = body.visibility;
        if (body.shares) sharingState.shares = body.shares.map((e: { email: string; role: string }) => ({ email: e.email.toLowerCase(), role: e.role }));
      }
      return new Response(JSON.stringify(sharingState), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ShareLink', () => {
  it('keeps the plain one-click copy button for non-owners (no dialog)', async () => {
    render(<ShareLink className="x" />);
    fireEvent.click(screen.getByLabelText('Share'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Copy link')).toBeNull();
  });

  it('opens ONE centered dialog for a session owner: copy link, flip visibility, invite an email', async () => {
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);

    // The old second button is gone — Share itself opens the dialog.
    expect(screen.queryByLabelText('Sharing options')).toBeNull();
    fireEvent.click(screen.getByLabelText('Share'));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Sharing' })).toHaveClass('max-w-2xl');

    // Copy link lives INSIDE the dialog now.
    fireEvent.click(screen.getByLabelText('Copy link'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);

    // Current state loads: private.
    await waitFor(() => expect(screen.getByLabelText('Make public')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Make public'));
    await waitFor(() => expect(sharingState.visibility).toBe('public'));

    fireEvent.click(screen.getByLabelText('Make private'));
    await waitFor(() => expect(sharingState.visibility).toBe('private'));

    fireEvent.change(screen.getByLabelText('Invite email'), { target: { value: 'Friend@Example.com' } });
    fireEvent.click(screen.getByLabelText('Add email'));
    await waitFor(() => expect(sharingState.shares).toEqual([{ email: 'friend@example.com', role: 'viewer' }]));

    // The row's control promotes them; the PUT carries the whole list with the new role.
    await waitFor(() => expect(screen.getByLabelText('Role for friend@example.com')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Role for friend@example.com'));
    fireEvent.click(screen.getByRole('option', { name: /can edit/ }));
    await waitFor(() => expect(sharingState.shares).toEqual([{ email: 'friend@example.com', role: 'editor' }]));

    // The invited address renders with a remove control.
    await waitFor(() => expect(screen.getByLabelText('Remove friend@example.com')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Remove friend@example.com'));
    await waitFor(() => expect(sharingState.shares).toEqual([]));
  });

  it('closes the sharing dialog with Escape', () => {
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);
    fireEvent.click(screen.getByLabelText('Share'));
    expect(screen.getByRole('dialog', { name: 'Sharing' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();
  });

  it('offers the people list under EVERY visibility — a public document can have editors', async () => {
    sharingState.visibility = 'public';
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);
    fireEvent.click(screen.getByLabelText('Share'));
    await waitFor(() => expect(screen.getByLabelText('Invite email')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Invite email'), { target: { value: 'ed@example.com' } });
    fireEvent.click(screen.getByLabelText('Add email'));
    await waitFor(() => expect(sharingState.shares).toEqual([{ email: 'ed@example.com', role: 'viewer' }]));
    // A viewer on a public document is told the link already grants that. The
    // marker sits on the WRAPPER: the control is the house dropdown, whose
    // labelled element is its trigger button inside the tooltip's span.
    const tipOn = (email: string) => screen.getByLabelText(`Role for ${email}`).closest('[data-slot="tooltip-trigger"]');
    await waitFor(() => expect(tipOn('ed@example.com')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Role for ed@example.com'));
    fireEvent.click(screen.getByRole('option', { name: /can edit/ }));
    await waitFor(() => expect(tipOn('ed@example.com')).toBeNull());
  });

  it('carries the verdict in the button: share: private / share: public', async () => {
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);
    // State loads on mount — the button must answer "who can see this" before
    // the popover is ever opened.
    await waitFor(() => expect(screen.getByLabelText('Share').textContent).toContain('share: private'));

    fireEvent.click(screen.getByLabelText('Share'));
    fireEvent.click(screen.getByLabelText('Make public'));
    await waitFor(() => expect(screen.getByLabelText('Share').textContent).toContain('share: public'));
  });

  it('keeps the visibility toggles on one line each', async () => {
    // "anyone with link" wrapped to two lines in the w-64 panel — the labels
    // must never break internally, whatever width the panel settles at.
    render(<ShareLink className="x" artifactId="Ab3xK9" owner />);
    fireEvent.click(screen.getByLabelText('Share'));
    await waitFor(() => expect(screen.getByLabelText('Make public')).toBeTruthy());
    expect((screen.getByLabelText('Make public') as HTMLElement).className).toContain('whitespace-nowrap');
    expect((screen.getByLabelText('Make private') as HTMLElement).className).toContain('whitespace-nowrap');
    // The current choice is visibly the chosen one: accent fill on the
    // selected toggle, muted chrome on the other.
    expect((screen.getByLabelText('Make private') as HTMLElement).className).toContain('bg-accent-soft');
    expect((screen.getByLabelText('Make public') as HTMLElement).className).not.toContain('bg-accent-soft');
  });
});
