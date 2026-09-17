/**
 * THE HOME PAGE ON A PHONE.
 *
 * Responsive coverage for the shelf.
 *
 * What is asserted here, and why each one is a real defect and not a taste:
 *
 *  1. EVERY GRID ITEM WEARS ITS CHROME ON THE PREVIEW.
 *  2. A TITLE GETS TWO LINES ON A PHONE rather than truncating to one.
 *  3. SEARCH GETS ITS OWN ROW. Filters sit below the field on phones and
 *     rejoin it from sm up, keeping the placeholder readable.
 *
 * Class assertions, deliberately: every one of these is a RESPONSIVE rule, and
 * jsdom has no layout — the breakpoint pair (`x sm:y`) is the whole contract,
 * and it is the thing a refactor would silently drop. Geometry belongs to the
 * browser gates.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Shelf, { type ShelfRow } from '@/components/Shelf';

const doc = (id: string, day: number, extra: Partial<ShelfRow> = {}): ShelfRow => ({
  id,
  url: `/a/${id}`,
  title: `Doc ${id}`,
  format: 'markup',
  version: 1,
  updated_at: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  ...extra,
});

describe('the shelf reads as ONE shelf on a phone', () => {
  it('keeps grid controls on the paper: the badge over the preview, the actions in the foot tab', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'private', views: 3 }), doc('b', 27, { visibility: 'public' })]} actions="full" />);

    const card = screen.getByLabelText('Open Doc a').closest('li')!;
    const paper = card.querySelector('img')!.parentElement!.parentElement!;
    const badge = screen.getByLabelText('Doc a is private');
    expect(paper).toContainElement(badge);
    expect(badge.closest('.gallery-fade-visibility')).toHaveClass('absolute');
    const foot = card.querySelector('.gallery-fade')!;
    expect(foot.parentElement).toBe(paper);
    expect(foot).toHaveClass('absolute', 'bottom-0');
    expect(foot).toContainElement(screen.getByLabelText('Edit Doc a'));
    expect(foot).toContainElement(screen.getByLabelText('Doc a views'));
    expect(screen.queryByLabelText('Share Doc a')).toBeNull();
  });

  it('caps every grid title at two lines', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    for (const link of [screen.getByLabelText('Open Doc a'), screen.getByLabelText('Open Doc b')]) {
      expect(link).toHaveClass('line-clamp-2');
      expect(link).not.toHaveClass('truncate');
    }
  });

  it('drops the filter chips below the search field rather than squeezing it', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'public' }), doc('b', 27, { visibility: 'private' })]} />);
    const input = screen.getByLabelText('Search artifacts');
    const searchRow = input.parentElement!;
    const toolbar = searchRow.parentElement!;
    expect(toolbar).toHaveClass('flex-col', 'sm:flex-row', 'sm:flex-wrap');
    expect(searchRow).toHaveClass('min-w-0', 'sm:flex-1');
    expect(input).toHaveClass('min-w-0', 'flex-1');
    const filters = searchRow.nextElementSibling as HTMLElement;
    expect(filters).toHaveClass('flex-wrap', 'sm:contents');
    expect(filters).toContainElement(screen.getByLabelText('Shelf view'));
    expect(screen.getByLabelText('Shelf view')).toHaveClass('shrink-0');
  });
});
