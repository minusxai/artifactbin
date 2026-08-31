/**
 * GENERAL ACCESS in the share popover — the second half of the tier row.
 *
 * The tier says who the LINK reaches (`public` listed, `unlisted` not,
 * `private` nobody); this row says what it grants them once it has. Two
 * controls, one block, because they are one question asked in two parts — and
 * the role row is meaningless while `private`, so it is not shown there.
 *
 * The wire field is `linkRole` (the sharing surface spells multi-word fields
 * in camelCase — `canPrivate`, `writtenBy`), sent alone: every control here is
 * a PATCH-shaped PUT, so setting the role never restates the tier (and cannot
 * clobber a tier someone changed in another tab).
 *
 * Both role controls in this popover are the HOUSE dropdown (SelectMenu), not
 * a native <select>: an option list is drawn by the OS, so a native one wears
 * system chrome in the middle of terminal-graphite panel. That makes them
 * listboxes — a trigger button naming the current value, options by role.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShareLink from '@/components/ShareLink';

const state = {
  visibility: 'unlisted' as string,
  linkRole: 'viewer' as string,
  shares: [] as unknown[],
  canPrivate: true,
};
let lastPut: Record<string, unknown> | null = null;

beforeEach(() => {
  Object.assign(state, { visibility: 'unlisted', linkRole: 'viewer', shares: [], canPrivate: true });
  lastPut = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.includes('/sharing')) {
      if (init?.method === 'PUT') {
        lastPut = JSON.parse(String(init.body));
        if (lastPut?.visibility) state.visibility = String(lastPut.visibility);
        if (lastPut?.linkRole) state.linkRole = String(lastPut.linkRole);
      }
      return new Response(JSON.stringify(state), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = () => fireEvent.click(screen.getByLabelText('Share'));

describe('ShareLink — general access', () => {
  it('offers the three roles a link may grant, seeded from the server', async () => {
    render(<ShareLink className="x" artifactId="Ab3xK9" owner format="markup" />);
    open();
    const trigger = await waitFor(() => screen.getByLabelText('Link role') as HTMLButtonElement);
    expect(trigger.tagName, 'the house dropdown, never a native select').toBe('BUTTON');
    expect(trigger.textContent).toContain('can view');
    fireEvent.click(trigger);
    expect(screen.getAllByRole('option').map((o) => o.textContent?.trim()))
      .toEqual(['can view', 'can comment', 'can edit']);
  });

  it('sends linkRole ALONE — a PATCH-shaped write that never restates the tier', async () => {
    render(<ShareLink className="x" artifactId="Ab3xK9" owner format="markup" />);
    open();
    const trigger = await waitFor(() => screen.getByLabelText('Link role') as HTMLButtonElement);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /can comment/ }));
    await waitFor(() => expect(lastPut).toEqual({ linkRole: 'commenter' }));
    await waitFor(() => expect(screen.getByLabelText('Link role').textContent).toContain('can comment'));
  });

  it('hides the role while PRIVATE — the link reaches nobody, so it grants nothing', async () => {
    Object.assign(state, { visibility: 'private' });
    render(<ShareLink className="x" artifactId="Ab3xK9" owner format="markup" />);
    open();
    await waitFor(() => expect(screen.getByLabelText('Make public')).toBeTruthy());
    expect(screen.queryByLabelText('Link role')).toBeNull();

    // …and it comes back with the tier, carrying the role the owner already
    // chose rather than resetting it (the server remembers it through private).
    fireEvent.click(screen.getByLabelText('Make unlisted'));
    await waitFor(() => expect(screen.getByLabelText('Link role')).toBeTruthy());
  });
});

describe('ShareLink — a person\'s role uses the same house dropdown', () => {
  it('is a listbox, not an OS-drawn select', async () => {
    Object.assign(state, { shares: [{ email: 'guest@example.com', role: 'viewer' }] });
    render(<ShareLink className="x" artifactId="Ab3xK9" owner format="markup" />);
    open();
    const trigger = await waitFor(() => screen.getByLabelText('Role for guest@example.com') as HTMLButtonElement);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toContain('can view');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /can edit/ }));
    await waitFor(() => expect(lastPut).toEqual({ shares: [{ email: 'guest@example.com', role: 'editor' }] }));
  });
});
