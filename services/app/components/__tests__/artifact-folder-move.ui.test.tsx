/**
 * Folder moves from the dashboard: a manage-mode row tucks "Move" and
 * "Delete" behind a "…" overflow menu (share and edit stay one click).
 * Move PATCHes `{ parent_id }` — the ID of a folder artifact, metadata-only,
 * never the content PUT — and reflects the new placement in place. Non-manage
 * rows get no menu at all.
 *
 * P1 keeps the field a plain id box; P2 replaces it with the folder picker
 * (the account's tree, with the row's own subtree greyed out — the cycle rule,
 * drawn). What must hold either way is the WIRE, which is what this asserts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactTable } from '@/components/TokenBrowser';

const ROW = {
  id: 'Ab3xK9',
  url: '/a/Ab3xK9',
  title: 'Eating Healthy',
  format: 'markup',
  version: 3,
  parent_id: 'f0Ld3r',
  visibility: 'private' as const,
  updated_at: new Date().toISOString(),
};

const patches: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  patches.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push({ url, body });
      return new Response(JSON.stringify({ id: ROW.id, parent_id: body.parent_id }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ArtifactTable folder moves', () => {
  it('keeps move and delete behind the overflow menu', () => {
    render(<ArtifactTable manage artifacts={[ROW]} />);
    // Share and edit are one click; move/delete only exist once the menu opens.
    expect(screen.getByLabelText('Share Eating Healthy')).toBeTruthy();
    expect(screen.getByLabelText('Edit Eating Healthy')).toBeTruthy();
    expect(screen.queryByLabelText('Move Eating Healthy')).toBeNull();
    expect(screen.queryByLabelText('Delete Eating Healthy')).toBeNull();

    fireEvent.click(screen.getByLabelText('More actions for Eating Healthy'));
    expect(screen.getByLabelText('Move Eating Healthy')).toBeTruthy();
    expect(screen.getByLabelText('Delete Eating Healthy')).toBeTruthy();

    // Toggling shut hides them again.
    fireEvent.click(screen.getByLabelText('More actions for Eating Healthy'));
    expect(screen.queryByLabelText('Move Eating Healthy')).toBeNull();
    expect(screen.queryByLabelText('Delete Eating Healthy')).toBeNull();
  });

  it('shows where the row sits and moves it via PATCH { parent_id }', async () => {
    render(<ArtifactTable manage artifacts={[ROW]} />);
    expect(screen.getByText('f0Ld3r')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('More actions for Eating Healthy'));
    fireEvent.click(screen.getByLabelText('Move Eating Healthy'));
    // Picking an action closes the menu.
    expect(screen.queryByLabelText('Delete Eating Healthy')).toBeNull();
    const input = screen.getByLabelText('Folder id') as HTMLInputElement;
    expect(input.value).toBe('f0Ld3r');

    fireEvent.change(input, { target: { value: 'Ar4Ch1' } });
    fireEvent.click(screen.getByLabelText('Save folder'));

    await waitFor(() => expect(patches).toEqual([
      { url: '/api/my/artifacts/Ab3xK9', body: { parent_id: 'Ar4Ch1' } },
    ]));
    await waitFor(() => expect(screen.getByText('Ar4Ch1')).toBeTruthy());
  });

  it('an EMPTY field is the root, which the wire spells null — never an absent field', async () => {
    render(<ArtifactTable manage artifacts={[ROW]} />);
    fireEvent.click(screen.getByLabelText('More actions for Eating Healthy'));
    fireEvent.click(screen.getByLabelText('Move Eating Healthy'));
    fireEvent.change(screen.getByLabelText('Folder id'), { target: { value: '  ' } });
    fireEvent.click(screen.getByLabelText('Save folder'));
    // Absent would mean "leave it where it is"; null means "the root". The two
    // must stay distinguishable on the wire.
    await waitFor(() => expect(patches).toEqual([
      { url: '/api/my/artifacts/Ab3xK9', body: { parent_id: null } },
    ]));
  });

  it('says who can read every row — public AND private are both marked', () => {
    // Claiming anonymous drafts leaves PUBLIC documents in the list; a
    // dashboard that never says so is how a user shares without knowing.
    // And once visibility is a thing the owner toggles, an unmarked row
    // reads as "unknown", so private earns its own quiet marker too.
    render(<ArtifactTable manage artifacts={[{ ...ROW, visibility: 'public' }, { ...ROW, id: 'Pv1vAt', title: 'Locked', visibility: 'private' }]} />);
    expect(screen.getByLabelText('Eating Healthy is public')).toBeTruthy();
    expect(screen.queryByLabelText('Locked is public')).toBeNull();
    expect(screen.getByLabelText('Locked is private')).toBeTruthy();
  });

  it('keeps a row on one line: the title truncates and badges never wrap', () => {
    const long = 'A Very Long Title That Would Otherwise Push The Public Badge Onto A Second Line';
    render(<ArtifactTable manage artifacts={[{ ...ROW, title: long, visibility: 'public' }]} />);
    // The title is the flexible element — it ellipsizes so the badges keep their room.
    expect((screen.getByLabelText(`Open ${long}`) as HTMLElement).className).toContain('truncate');
    // The format badge must never break internally ("mx-" / "markup"). Two
    // elements say "mx-markup" now — the badge in its own DESKTOP column, and
    // the phone's stacked meta line under the title, which exists because that
    // column is hidden there. This assertion is about the badge, so it names
    // the badge rather than whichever one the DOM happens to reach first.
    const badge = screen
      .getAllByText('mx-markup')
      .find((el) => el.closest('td')?.className.includes('sm:table-cell'))!;
    expect(badge.className).toContain('whitespace-nowrap');
    // The public marker sits beside the title, not under it.
    expect((screen.getByLabelText(`${long} is public`) as HTMLElement).className).toContain('shrink-0');
  });

  it('offers no overflow menu outside manage mode', () => {
    render(<ArtifactTable artifacts={[ROW]} />);
    expect(screen.queryByLabelText('More actions for Eating Healthy')).toBeNull();
    expect(screen.queryByLabelText('Move Eating Healthy')).toBeNull();
  });
});
