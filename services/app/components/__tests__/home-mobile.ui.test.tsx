/**
 * THE HOME PAGE ON A PHONE.
 *
 * Responsive coverage for the shelf and the top bar’s drawer.
 *
 * What is asserted here, and why each one is a real defect and not a taste:
 *
 *  1. EVERY GRID ITEM WEARS ITS CHROME ON THE PREVIEW.
 *  2. A TITLE GETS TWO LINES ON A PHONE rather than truncating to one.
 *  3. THE SEARCH ROW WRAPS. Three visibility chips beside the input left it
 *     ~130px wide, and its own placeholder was truncated mid-word. Chips fall
 *     to a second line rather than eating the field.
 *  4. THE DRAWER IS A SHEET. A 240px pane over a 390px screen is a desktop
 *     menu shown on a phone; the same markup is a full-width sheet there.
 *
 * Class assertions, deliberately: every one of these is a RESPONSIVE rule, and
 * jsdom has no layout — the breakpoint pair (`x sm:y`) is the whole contract,
 * and it is the thing a refactor would silently drop. Geometry belongs to the
 * browser gates.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Shelf, { type ShelfRow } from '@/components/Shelf';
import { PageMenu } from '@/components/PageChrome';

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
  it('keeps icon view controls over the preview', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'private' }), doc('b', 27, { visibility: 'public' })]} actions="full" />);

    const card = screen.getByLabelText('Open Doc a').closest('li')!;
    const overlay = screen.getByLabelText('Doc a card controls');
    expect(overlay.parentElement).toBe(card.querySelector('img')!.parentElement!.parentElement);
    expect(overlay).toHaveClass('absolute', 'z-10', 'justify-between');
    expect(overlay).toContainElement(screen.getByLabelText('Doc a is private'));
    expect(overlay).toContainElement(screen.getByLabelText('Share Doc a'));
    expect(overlay).toContainElement(screen.getByLabelText('Edit Doc a'));
  });

  it('keeps every grid title to one ellipsized line', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    for (const link of [screen.getByLabelText('Open Doc a'), screen.getByLabelText('Open Doc b')]) {
      expect(link).toHaveClass('truncate');
      expect(link).not.toHaveClass('line-clamp-2');
    }
  });

  it('drops the filter chips below the search field rather than squeezing it', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'public' }), doc('b', 27, { visibility: 'private' })]} />);
    const input = screen.getByLabelText('Search artifacts');
    const row = input.parentElement!;
    expect(row).toHaveClass('flex-wrap');
    // A floor, so the field is a field even on the line it shares.
    expect(input).toHaveClass('min-w-32', 'flex-1');
    expect(input).not.toHaveClass('w-full');
    expect(screen.getByLabelText('Shelf view')).toHaveClass('shrink-0');
  });
});

describe('the menu is a sheet on a phone', () => {
  it('opens full width there and keeps the 240px pane on a desktop', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Menu')).toHaveClass('w-full', 'sm:w-72');
  });
});
