/** The shared Drive-like shelf used by the homepage and public profiles. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Shelf, { SHELF_LIST_PER_PAGE, type ShelfRow } from '@/components/Shelf';

const doc = (id: string, day: number, extra: Partial<ShelfRow> = {}): ShelfRow => ({
  id,
  url: `/a/${id}`,
  title: `Doc ${id}`,
  format: 'markup',
  version: 1,
  updated_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  ...extra,
});
const asset = (id: string, day: number, format = 'dataset'): ShelfRow => ({
  ...doc(id, day),
  title: `Asset ${id}`,
  format,
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Shelf — grid and list views', () => {
  it('starts as one uniform grid with no promoted hero', () => {
    render(<Shelf rows={[doc('a', 20), doc('b', 28), doc('c', 26), doc('d', 24)]} />);
    const grid = screen.getByLabelText('Artifact grid');
    expect(grid.querySelector('ul')).toHaveClass('lg:grid-cols-4');
    expect(grid).toHaveTextContent('Doc a');
    expect(grid).toHaveTextContent('Doc b');
    expect(screen.queryByLabelText(/most recent/)).toBeNull();
    expect(screen.getByLabelText('Grid view')).toHaveAttribute('aria-pressed', 'true');
  });

  it('breaks a long icon grid into Finder-like date bands', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00'));
    render(
      <Shelf
        rows={[
          doc('today', 28, { updated_at: '2026-09-04T09:00:00' }),
          doc('yesterday', 28, { updated_at: '2026-09-03T09:00:00' }),
          doc('week', 28, { updated_at: '2026-08-31T09:00:00' }),
          doc('month', 28, { updated_at: '2026-08-12T09:00:00' }),
        ]}
      />,
    );
    for (const label of ['Today', 'Yesterday', 'This Week', 'Last Month']) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy();
    }
    expect(screen.getByLabelText('Yesterday artifacts')).toHaveTextContent('Doc yesterday');
    expect(screen.getByLabelText('Last Month artifacts')).toHaveTextContent('Doc month');
    expect(screen.queryByLabelText('Older artifacts')).toBeNull();

    fireEvent.click(screen.getByLabelText('List view'));
    expect(screen.queryByLabelText('Yesterday artifacts')).toBeNull();
  });

  it('toggles the same documents into a paged list', () => {
    const rows = Array.from({ length: 12 }, (_, i) => doc(`d${String(i).padStart(2, '0')}`, 28 - i));
    render(<Shelf rows={rows} />);
    fireEvent.click(screen.getByLabelText('List view'));
    expect(screen.queryByLabelText('Artifact grid')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByLabelText('List view')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Next page')).toBeTruthy();
    expect(SHELF_LIST_PER_PAGE).toBe(10);
  });

  it('keeps the search above both views', () => {
    render(<Shelf rows={[doc('alpha', 28), doc('beta', 27)]} />);
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'beta' } });
    const grid = screen.getByLabelText('Artifact grid');
    expect(grid).toHaveTextContent('Doc beta');
    expect(grid).not.toHaveTextContent('Doc alpha');
    fireEvent.click(screen.getByLabelText('List view'));
    expect(screen.getByRole('table')).toHaveTextContent('Doc beta');
  });

  it('filters owner rows by visibility from the search rail', () => {
    render(<Shelf rows={[doc('pub', 28, { visibility: 'public' }), doc('priv', 27, { visibility: 'private' })]} />);
    fireEvent.click(screen.getByLabelText('Filter public'));
    const grid = screen.getByLabelText('Artifact grid');
    expect(grid).toHaveTextContent('Doc pub');
    expect(grid).not.toHaveTextContent('Doc priv');
  });
});

describe('Shelf — data and capabilities', () => {
  it('renders view telemetry only when the page supplies it', () => {
    const { rerender } = render(<Shelf rows={[doc('a', 28, { views: 42, sparkline: '<svg data-spline="1"></svg>' })]} />);
    const views = screen.getByLabelText('Doc a views');
    expect(views).toHaveTextContent('42 views');
    expect(views.querySelector('[data-spline]')).toBeTruthy();
    expect(views.querySelector('[data-spline]')?.parentElement).toHaveClass('absolute', 'inset-0', 'w-full');
    expect(screen.getByText('42 views')).toHaveClass('text-[9px]', 'bg-surface/55', 'px-0.5');
    expect(screen.getByLabelText('Doc a updated')).toHaveClass('ml-auto');
    rerender(<Shelf rows={[doc('a', 28)]} />);
    expect(screen.queryByLabelText('Doc a views')).toBeNull();
    expect(screen.getByLabelText('Doc a updated')).not.toHaveClass('ml-auto');
  });

  it('shows visibility as a white icon badge with its meaning in hover chrome', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'private' })]} />);
    const badge = screen.getByLabelText('Doc a is private');
    expect(badge).toHaveClass('bg-white', 'w-[26px]');
    expect(badge).toHaveTextContent('');
    expect(badge).toHaveAttribute('data-slot', 'tooltip-trigger');
  });

  it('gives every grid item the full owner action set', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    for (const id of ['a', 'b']) {
      expect(screen.getByLabelText(`Share Doc ${id}`)).toBeTruthy();
      expect(screen.getByLabelText(`Edit Doc ${id}`)).toHaveAttribute('href', `/a/${id}#edit`);
      expect(screen.getByLabelText(`More actions for Doc ${id}`)).toBeTruthy();
    }
  });

  it('share-only profile mode cannot edit, move, or delete', () => {
    render(<Shelf rows={[doc('a', 28)]} actions="share" />);
    expect(screen.getByLabelText('Share Doc a')).toBeTruthy();
    expect(screen.queryByLabelText('Edit Doc a')).toBeNull();
    expect(screen.queryByLabelText('More actions for Doc a')).toBeNull();
    fireEvent.click(screen.getByLabelText('List view'));
    expect(screen.getByLabelText('Share Doc a')).toBeTruthy();
    expect(screen.queryByLabelText('Edit Doc a')).toBeNull();
    expect(screen.queryByLabelText('More actions for Doc a')).toBeNull();
  });

  it('moves a grid item through its overflow menu', async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      patches.push({ url, body });
      return new Response(JSON.stringify({ parent_id: body.parent_id }), { status: 200 });
    }));
    /*
     * Placement is an ID on the wire — two sibling folders may share a name, so
     * a path was ambiguous by construction — but the PERSON picks a folder by
     * name, from the account's own tree. The shelf's folder rows ARE that tree,
     * which is why the picker needs nothing fetched.
     */
    render(
      <Shelf
        actions="full"
        rows={[
          doc('a', 28),
          doc('b', 27, { parent_id: 'dR4fts' }),
          { ...doc('dR4fts', 26), title: 'Drafts', format: 'folder' },
          { ...doc('Ar4Ch1', 25), title: 'Archive', format: 'folder' },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText('More actions for Doc b'));
    fireEvent.click(screen.getByLabelText('Move Doc b'));
    // Grid cards clip their contents to preserve the rounded thumbnail. The
    // picker must escape that clipping context and float at viewport level.
    const picker = screen.getByRole('dialog', { name: 'Move to folder' });
    expect(picker.parentElement).toBe(document.body);
    expect(picker).toHaveClass('fixed', 'z-[70]');
    // It opens on where the row sits today.
    expect(screen.getByLabelText('Move to Drafts').getAttribute('aria-current')).toBe('location');
    fireEvent.click(screen.getByLabelText('Move to Archive'));
    await waitFor(() => expect(patches).toEqual([
      { url: '/api/my/artifacts/b', body: { parent_id: 'Ar4Ch1' } },
    ]));
  });

  it('keeps the whole grid item clickable without nesting buttons in its link', () => {
    render(<Shelf rows={[doc('a', 28)]} actions="full" />);
    const open = screen.getByLabelText('Open Doc a');
    expect(open.tagName).toBe('A');
    expect(open).toHaveClass('truncate');
    expect(open).not.toHaveClass('line-clamp-2');
    expect(open.parentElement).toHaveClass('gap-2', 'px-3', 'py-2.5');
    expect(open.querySelector('button')).toBeNull();
  });
});

describe('Shelf — assets stay separate', () => {
  const rows = [doc('m1', 27), asset('d1', 28), asset('i1', 26, 'image')];

  it('keeps assets out of the document grid and in their own management table', () => {
    render(<Shelf rows={rows} actions="full" />);
    expect(screen.getByLabelText('Artifact grid')).toHaveTextContent('Doc m1');
    expect(screen.getByLabelText('Artifact grid')).not.toHaveTextContent('Asset d1');
    const assets = screen.getByLabelText('Assets');
    expect(assets).toHaveTextContent('Asset d1');
    expect(assets).toHaveTextContent('Asset i1');
    expect(assets.querySelector('table')).toBeTruthy();
    expect(screen.getByLabelText('More actions for Asset d1')).toBeTruthy();
    expect(screen.queryByLabelText('Share Asset d1')).toBeNull();
  });

  it('can omit assets entirely for a profile', () => {
    render(<Shelf rows={rows} assets={false} actions="share" />);
    expect(screen.queryByLabelText('Assets')).toBeNull();
    expect(screen.getByLabelText('Artifact grid')).toHaveTextContent('Doc m1');
  });
});
