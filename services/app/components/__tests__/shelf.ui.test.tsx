/**
 * The shelf on screen.
 *
 * Two things are load-bearing here and neither is styling.
 *
 * CAPABILITY DEGRADATION: a shelf handed no view counts must draw none, with
 * no column reserved and no zero printed. That is the test of whether the
 * seam between the three listing pages is in the right place — if the
 * dashboard's spline leaked into the profile's markup, the pages would be
 * coupled through this component and every future field would have to be
 * added twice.
 *
 * SEARCH FLATTENS: tiers describe browsing. A result set is already ordered
 * by what the user asked for, so promoting its first hit to full width would
 * announce "this is where you left off" about a row they have never seen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Shelf, { SHELF_LIST_PER_PAGE, type ShelfRow } from '@/components/Shelf';
import { VISIBILITY_COLORS } from '@/components/ui';

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

const heroLink = () => screen.queryByLabelText(/^Open Doc .* \(most recent\)$/);

afterEach(() => vi.unstubAllGlobals());

describe('Shelf — tiers on screen', () => {
  it('paginates both dense tables at ten rows', () => {
    expect(SHELF_LIST_PER_PAGE).toBe(10);
  });

  it('gives the most recent document the hero, and the rest their tiers', () => {
    render(<Shelf rows={[doc('a', 20), doc('b', 28), doc('c', 26), doc('d', 24), doc('e', 22)]} />);
    // b is newest → hero. c, d, e → cards. a → the dense tier.
    expect(heroLink()).toHaveAttribute('aria-label', 'Open Doc b (most recent)');
    const cards = screen.getByLabelText('Recent documents');
    expect(cards).toHaveTextContent('Doc c');
    expect(cards).toHaveTextContent('Doc d');
    expect(cards).toHaveTextContent('Doc e');
    expect(cards).not.toHaveTextContent('Doc a');
    // The dense tier is ArtifactTable, which labels its own row links.
    expect(screen.getByLabelText('Open Doc a')).toBeTruthy();
  });

  it('does not repeat the document type in the markup-only archive table', () => {
    render(<Shelf rows={[doc('a', 20), doc('b', 28), doc('c', 26), doc('d', 24), doc('e', 22)]} />);
    const archive = screen.getByRole('table');
    expect(archive).not.toHaveTextContent('type');
    expect(archive).not.toHaveTextContent('mx-markup');
  });

  it('never promotes an asset to the hero, however recent', () => {
    render(<Shelf rows={[asset('d1', 28), doc('m1', 27)]} />);
    expect(heroLink()).toHaveAttribute('aria-label', 'Open Doc m1 (most recent)');
  });

  it('keeps assets out of the document flow and in their own section', () => {
    // Three documents so a card tier actually exists to assert the absence in.
    render(
      <Shelf
        rows={[
          doc('m1', 28),
          doc('m2', 25),
          doc('m3', 24),
          { ...asset('d1', 27), visibility: 'private', views: 7, sparkline: '<svg data-spline="asset"></svg>' },
          { ...asset('i1', 26, 'image'), visibility: 'public', views: 3 },
        ]}
      />,
    );
    const assets = screen.getByLabelText('Assets');
    expect(assets).toHaveTextContent('Asset d1');
    expect(assets).toHaveTextContent('Asset i1');
    expect(screen.getByLabelText('Recent documents')).not.toHaveTextContent('Asset d1');
    expect(assets.querySelector('table')).toBeTruthy();
    expect(assets.querySelector('[aria-label="Search artifacts"]')).toBeTruthy();
    expect(assets.querySelector('[aria-label="Filter dataset"]')).toBeTruthy();
    expect(assets.querySelector('[aria-label="Filter image"]')).toBeTruthy();
    const assetSearch = assets.querySelector('[aria-label="Search artifacts"]')!;
    expect(assetSearch.parentElement).toContainElement(assets.querySelector('[aria-label="Filter public"]'));
    expect(assetSearch.parentElement).toContainElement(assets.querySelector('[aria-label="Filter private"]'));
    expect(assets.querySelector('thead')).toHaveTextContent('title');
    expect(assets.querySelector('thead')).toHaveTextContent('type');
    expect(assets.querySelector('thead')).not.toHaveTextContent('views');
    expect(screen.queryByLabelText('Asset d1 views')).toBeNull();
  });

  it('says nothing at all when there is nothing', () => {
    render(<Shelf rows={[]} />);
    expect(heroLink()).toBeNull();
    expect(screen.queryByLabelText('Recent documents')).toBeNull();
    expect(screen.queryByLabelText('Assets')).toBeNull();
  });
});

describe('Shelf — the dense tier is the only one that pages', () => {
  it('paginates the archive after ten rows', () => {
    // 20 documents: 1 hero + 3 cards leaves 16 for the dense tier.
    const rows = Array.from({ length: 20 }, (_, i) => doc(`d${String(i).padStart(2, '0')}`, 28 - i));
    render(<Shelf rows={rows} />);
    expect(screen.getByLabelText('Open Doc d13')).toBeTruthy();
    expect(screen.queryByLabelText('Open Doc d14')).toBeNull();
    expect(screen.getByLabelText('Next page')).toBeTruthy();
  });
});

describe('Shelf — capabilities degrade', () => {
  it('draws a spline and a count when the page supplied them', () => {
    render(<Shelf rows={[doc('a', 28, { views: 42, sparkline: '<svg data-spline="1"></svg>' })]} />);
    const hero = screen.getByLabelText('Doc a views');
    expect(hero).toHaveTextContent('42');
    expect(hero.querySelector('[data-spline]')).toBeTruthy();
  });

  it('draws NOTHING when the page supplied neither — no zero, no empty slot', () => {
    render(<Shelf rows={[doc('a', 28)]} />);
    expect(screen.queryByLabelText('Doc a views')).toBeNull();
  });

  it('shows a visibility mark only when the page knows it', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'public' }), doc('b', 27)]} />);
    expect(screen.getByLabelText('Doc a is public')).toBeTruthy();
    expect(screen.queryByLabelText(/^Doc b is /)).toBeNull();
  });

  it('does not repeat the document format on hero or cards, but keeps it for mixed assets', () => {
    render(
      <Shelf
        rows={[
          doc('a', 28, { visibility: 'public' }),
          doc('b', 27, { visibility: 'private' }),
          asset('data', 26),
        ]}
      />,
    );
    const hero = screen.getByLabelText('Open Doc a (most recent)').closest('article')!;
    const card = screen.getByLabelText('Open Doc b').closest('li')!;
    expect(hero).not.toHaveTextContent('mx-markup');
    expect(card).not.toHaveTextContent('mx-markup');
    expect(hero).toHaveTextContent('public');
    expect(card).toHaveTextContent('private');
    expect(screen.getByLabelText('Assets')).toHaveTextContent('dataset');
  });
});

describe('Shelf — every tier carries its actions and its time', () => {
  it('gives the hero and the cards the same actions the dense rows have', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27), doc('c', 26)]} actions="full" />);
    // Hero.
    expect(screen.getByLabelText('Share Doc a')).toBeTruthy();
    expect(screen.getByLabelText('Edit Doc a')).toBeTruthy();
    // Cards. Reaching a document's editor should not require finding it in
    // the dense tier first — the tiers differ in WEIGHT, never in capability.
    expect(screen.getByLabelText('Share Doc b')).toBeTruthy();
    expect(screen.getByLabelText('Edit Doc b')).toBeTruthy();
  });

  it('places a card actions cluster over the thumbnail at top right', () => {
    render(
      <Shelf
        rows={[doc('a', 28, { visibility: 'public' }), doc('b', 27, { visibility: 'private' })]}
        actions="full"
      />,
    );
    const title = screen.getByLabelText('Open Doc b');
    const card = title.closest('li')!;
    const thumbnail = card.querySelector('img')!.parentElement!;
    const overlay = screen.getByLabelText('Doc b card controls');
    expect(overlay.parentElement).toBe(thumbnail.parentElement);
    expect(overlay).toHaveClass('absolute', 'inset-x-2.5', 'top-2.5', 'justify-between');
    expect(overlay).toContainElement(screen.getByLabelText('Doc b is private'));
    expect(overlay).toContainElement(screen.getByLabelText('Share Doc b'));
  });

  it('colors the visibility badge with the theme accent while keeping action chrome quiet', () => {
    render(
      <Shelf
        rows={[doc('a', 28, { visibility: 'public' }), doc('b', 27, { visibility: 'private' })]}
        actions="full"
      />,
    );
    const badge = screen.getByLabelText('Doc b is private');
    const actionSurface = screen.getByLabelText('Share Doc b').parentElement!.parentElement!;
    for (const surface of [badge, actionSurface]) {
      expect(surface).toHaveClass('h-[26px]', 'rounded-[4px]');
      expect(surface).not.toHaveClass('shadow-sm');
    }
    expect(badge).toHaveClass('border-accent/40', 'bg-accent-soft', 'text-accent', 'text-[10px]');
    expect(actionSurface).toHaveClass('border-edge', 'bg-surface/90');
  });

  it('replaces the hero most-recent label with visibility beside its actions', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'public' })]} actions="full" />);
    const badge = screen.getByLabelText('Doc a is public');
    const actionSurface = screen.getByLabelText('Share Doc a').parentElement!.parentElement!;
    expect(badge.parentElement).toBe(actionSurface.parentElement);
    expect(badge).toHaveClass('h-[26px]', 'rounded-[4px]', 'border-accent/40', 'bg-accent-soft', 'text-accent', 'text-[10px]');
    expect(actionSurface).toHaveClass('h-[26px]', 'rounded-[4px]', 'border-edge', 'bg-surface/90');
    expect(screen.getByLabelText('Open Doc a (most recent)').closest('article')).not.toHaveTextContent('most recent');
  });

  it('adds the archive move/delete menu to the hero and card actions', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    expect(screen.getByLabelText('More actions for Doc a')).toBeTruthy();
    expect(screen.getByLabelText('More actions for Doc b')).toBeTruthy();
    expect(screen.queryByLabelText('Move Doc b')).toBeNull();
    fireEvent.click(screen.getByLabelText('More actions for Doc b'));
    expect(screen.getByLabelText('Move Doc b')).toBeTruthy();
    expect(screen.getByLabelText('Delete Doc b')).toBeTruthy();
  });

  it('moves a card from its overflow menu with the metadata PATCH', async () => {
    const patches: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      patches.push({ url, body });
      return new Response(JSON.stringify({ parent_id: body.parent_id }), { status: 200 });
    }));
    // Placement is an ID on the wire — two sibling folders may share a name,
    // so a path was ambiguous by construction. P2 makes the field a picker.
    render(<Shelf rows={[doc('a', 28), doc('b', 27, { parent_id: 'dR4fts' })]} actions="full" />);
    fireEvent.click(screen.getByLabelText('More actions for Doc b'));
    fireEvent.click(screen.getByLabelText('Move Doc b'));
    const input = screen.getByLabelText('Folder id') as HTMLInputElement;
    expect(input.value).toBe('dR4fts');
    fireEvent.change(input, { target: { value: 'Ar4Ch1' } });
    fireEvent.click(screen.getByLabelText('Save folder'));
    await waitFor(() => expect(patches).toEqual([
      { url: '/api/my/artifacts/b', body: { parent_id: 'Ar4Ch1' } },
    ]));
  });

  it('the edit action addresses the document by its one id', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    expect(screen.getByLabelText('Edit Doc b')).toHaveAttribute('href', '/a/b#edit');
  });

  it('dates the cards, not only the hero', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} />);
    expect(screen.getByLabelText('Doc b updated')).toBeTruthy();
  });

  it('uses readable idle ink for dark-theme actions and timestamps', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    for (const id of ['a', 'b']) {
      for (const action of ['Share', 'Edit', 'More actions for']) {
        const label = `${action} Doc ${id}`;
        expect(screen.getByLabelText(label)).toHaveClass('text-muted');
        expect(screen.getByLabelText(label)).not.toHaveClass('text-faint');
      }
      expect(screen.getByLabelText(`Doc ${id} updated`)).toHaveClass('text-muted');
    }
  });

  it('keeps the card clickable as a whole despite carrying buttons', () => {
    // A button nested inside an anchor is invalid and swallows the click, so
    // the card body is a stretched link and the actions sit above it.
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    const open = screen.getByLabelText('Open Doc b');
    expect(open.tagName).toBe('A');
    expect(open.querySelector('button')).toBeNull();
  });
});

describe('Shelf — card telemetry', () => {
  const rows = [
    doc('a', 28, { views: 5, sparkline: '<svg data-spline="hero"><path data-area fill-opacity="0.18" /></svg>' }),
    doc('b', 27, { views: 4, sparkline: '<svg data-spline="card"><path data-area fill-opacity="0.18" /></svg>' }),
  ];

  it('keeps both the count and the spline on a card', () => {
    render(<Shelf rows={rows} actions="full" />);
    const card = screen.getByLabelText('Doc b views');
    expect(card).toHaveTextContent('4');
    expect(card.querySelector('[data-spline]')).toBeTruthy();
  });

  it('and the hero keeps both, because it has the room', () => {
    render(<Shelf rows={rows} actions="full" />);
    const hero = screen.getByLabelText('Doc a views');
    expect(hero).toHaveTextContent('5');
    expect(hero.querySelector('[data-spline]')).toBeTruthy();
  });

  it('keeps the extra-wide hero spline line-only while retaining the compact card fill', () => {
    render(<Shelf rows={rows} actions="full" />);
    expect(screen.getByLabelText('Doc a views').querySelector('[data-area]')).toHaveAttribute('fill-opacity', '0');
    expect(screen.getByLabelText('Doc b views').querySelector('[data-area]')).toHaveAttribute('fill-opacity', '0.18');
  });

  it('lets the spline consume the row while the timestamp keeps its intrinsic width', () => {
    render(<Shelf rows={rows} actions="full" />);
    for (const id of ['a', 'b']) {
      const views = screen.getByLabelText(`Doc ${id} views`);
      const spline = views.querySelector('[data-spline]')!.parentElement!;
      const stamp = screen.getByLabelText(`Doc ${id} updated`);
      expect(views).toHaveClass('min-w-0', 'flex-1');
      expect(spline).toHaveClass('min-w-0', 'flex-1', '[&>svg]:w-full');
      expect(views.querySelector('[data-spline]')).toHaveAttribute('preserveAspectRatio', 'none');
      // The stretch is non-uniform (wide, not tall), and a stroke scales with
      // the geometry it rides — the spike's near-vertical segments drew ~5×
      // fatter than the flat baseline. Non-scaling strokes keep one thickness.
      expect(views.querySelector('path')).toHaveAttribute('vector-effect', 'non-scaling-stroke');
      expect(stamp).toHaveClass('shrink-0');
      // The COUNT leads the mark, and it says what it counts. With the spline
      // between them, the bare count landed beside the timestamp and
      // "1 · 5 hrs ago" read as "1 5 hrs"; "1 view" cannot be misread.
      expect(views.firstElementChild!.textContent).toBe(id === 'a' ? '5 views' : '4 views');
    }
  });
});

describe('Shelf — capability is a LEVEL, and the profile withholds most of it', () => {
  it('share-only offers the link and nothing that changes the document', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27), doc('c', 26), doc('d', 25), doc('e', 24)]} actions="share" />);
    // The point of a profile is handing someone the link.
    expect(screen.getByLabelText('Share Doc a')).toBeTruthy();
    expect(screen.getByLabelText('Share Doc b')).toBeTruthy();
    // Editing and the overflow menu are the owner's dashboard, not a profile.
    expect(screen.queryByLabelText('Edit Doc a')).toBeNull();
    expect(screen.queryByLabelText('Edit Doc b')).toBeNull();
    expect(screen.queryByLabelText(/^More actions for/)).toBeNull();
  });

  it('offers nothing at all at the lowest level', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="none" />);
    expect(screen.queryByLabelText('Share Doc a')).toBeNull();
    expect(screen.queryByLabelText('Edit Doc a')).toBeNull();
  });

  it('withholds everything by default — least privilege', () => {
    render(<Shelf rows={[doc('a', 28)]} />);
    expect(screen.queryByLabelText('Share Doc a')).toBeNull();
  });

  it('can be told to leave the assets band out entirely', () => {
    const rows = [doc('m1', 28), asset('d1', 27)];
    expect(screen.queryByLabelText('Assets')).toBeNull();
    const { rerender } = render(<Shelf rows={rows} />);
    expect(screen.getByLabelText('Assets')).toBeTruthy();
    rerender(<Shelf rows={rows} assets={false} />);
    expect(screen.queryByLabelText('Assets')).toBeNull();
    // The documents are unaffected — hiding the band is not filtering the shelf.
    expect(screen.getByLabelText('Open Doc m1 (most recent)')).toBeTruthy();
  });

  it('gives an asset row the overflow menu, so material can be deleted too', () => {
    render(<Shelf rows={[doc('m1', 28), asset('d1', 27)]} actions="full" />);
    expect(screen.getByLabelText('More actions for Asset d1')).toBeTruthy();
    expect(screen.queryByLabelText('Share Asset d1')).toBeNull();
    expect(screen.queryByLabelText('Edit Asset d1')).toBeNull();
  });

  it('gives an asset row NO menu when the viewer may not manage', () => {
    render(<Shelf rows={[doc('m1', 28), asset('d1', 27)]} actions="share" />);
    expect(screen.queryByLabelText('More actions for Asset d1')).toBeNull();
  });
});

describe('Shelf — visibility is filterable from the search bar', () => {
  const mixed = [
    doc('pub', 28, { visibility: 'public' }),
    doc('unl', 27, { visibility: 'unlisted' }),
    doc('priv', 26, { visibility: 'private' }),
    doc('priv2', 25, { visibility: 'private' }),
  ];

  it('offers a chip per visibility actually present', () => {
    render(<Shelf rows={mixed} />);
    expect(screen.getByLabelText('Filter public')).toBeTruthy();
    expect(screen.getByLabelText('Filter unlisted')).toBeTruthy();
    expect(screen.getByLabelText('Filter private')).toBeTruthy();
  });

  it('uses one neutral color treatment for every visibility state', () => {
    render(<Shelf rows={mixed} />);
    expect(new Set(Object.values(VISIBILITY_COLORS)).size).toBe(1);

    for (const visibility of ['public', 'unlisted', 'private']) {
      fireEvent.click(screen.getByLabelText(`Filter ${visibility}`));
    }
    const chipStyles = ['public', 'unlisted', 'private'].map((visibility) =>
      screen.getByLabelText(`Filter ${visibility}`).getAttribute('style'),
    );
    expect(new Set(chipStyles).size).toBe(1);
  });

  it('offers no chips when there is nothing to split on', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'private' }), doc('b', 27, { visibility: 'private' })]} />);
    expect(screen.queryByLabelText('Filter private')).toBeNull();
  });

  it('narrows the shelf to the picked visibility, and composes with search', () => {
    render(<Shelf rows={mixed} />);
    fireEvent.click(screen.getByLabelText('Filter private'));
    expect(screen.queryByLabelText(/^Open Doc pub/)).toBeNull();
    expect(screen.getByLabelText('Open Doc priv (most recent)')).toBeTruthy();
    // Picking again clears it.
    fireEvent.click(screen.getByLabelText('Filter private'));
    expect(screen.getByLabelText('Open Doc pub (most recent)')).toBeTruthy();
  });

  it('marks the active chip pressed, for anyone not looking at colour', () => {
    render(<Shelf rows={mixed} />);
    const chip = screen.getByLabelText('Filter public');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Shelf — search flattens the tiers', () => {
  const rows = [doc('alpha', 28), doc('beta', 27), doc('gamma', 26), doc('delta', 25), doc('other', 24)];

  it('drops the hero and the card tier once a query is active', () => {
    render(<Shelf rows={rows} />);
    expect(heroLink()).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'a' } });
    expect(heroLink()).toBeNull();
    expect(screen.queryByLabelText('Recent documents')).toBeNull();
  });

  it('restores the tiers when the query is cleared', () => {
    render(<Shelf rows={rows} />);
    const box = screen.getByLabelText('Search artifacts');
    fireEvent.change(box, { target: { value: 'alpha' } });
    expect(heroLink()).toBeNull();
    fireEvent.change(box, { target: { value: '' } });
    expect(heroLink()).toHaveAttribute('aria-label', 'Open Doc alpha (most recent)');
  });

  it('matches on title, and says so when nothing matches', () => {
    render(<Shelf rows={rows} />);
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'zzz' } });
    expect(screen.getByLabelText('No matches')).toBeTruthy();
  });
});
