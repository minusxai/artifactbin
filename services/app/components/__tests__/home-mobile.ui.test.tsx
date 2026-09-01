/**
 * THE HOME PAGE ON A PHONE.
 *
 * The home page is three pieces of chrome stacked — the masthead, the shelf's
 * tiers, and the bar's drawer — and each of them was drawn for a desktop
 * column. This file is the one place their PHONE shape is pinned, because the
 * faults are not per-component bugs: they are the same fault (a width that was
 * always there is suddenly the scarce thing) landing in three files.
 *
 * What is asserted here, and why each one is a real defect and not a taste:
 *
 *  1. THE HERO WEARS ITS CHROME WHERE A CARD DOES. The hero is a two-column
 *     grid on desktop, so its classification and controls sat at the top of
 *     the RIGHT column. Stacked on a phone that column falls under the
 *     picture, and the same two controls that overlay the thumbnail on every
 *     card appeared in a band beneath it on the one above them — the tiers
 *     stopped looking like one shelf. Putting them on the picture is one rule
 *     for every tier and no breakpoint fork.
 *  2. A TITLE GETS TWO LINES ON A PHONE. `truncate` is right in a wide column
 *     and wrong in a narrow one: at 390px it cut the hero's title to four
 *     words. The tier still refuses to grow without bound — two lines, then
 *     the ellipsis.
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

import HeaderBar from '@/components/HeaderBar';
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
  it('hangs the hero classification and controls on the CARD, at the same corner as every tier', () => {
    render(<Shelf rows={[doc('a', 28, { visibility: 'private' }), doc('b', 27, { visibility: 'public' })]} actions="full" />);

    const hero = screen.getByLabelText('Open Doc a (most recent)').closest('article')!;
    const overlay = screen.getByLabelText('Doc a card controls');

    // Anchored to the ARTICLE: on desktop the hero is two columns and its far
    // corner is the right column's, where the actions belong; stacked on a
    // phone the card's top IS the picture's top — same corner as a card's.
    expect(overlay.parentElement).toBe(hero);
    expect(overlay).toHaveClass('absolute', 'inset-x-2.5', 'top-2.5', 'justify-between');
    expect(overlay).toContainElement(screen.getByLabelText('Doc a is private'));
    expect(overlay).toContainElement(screen.getByLabelText('Share Doc a'));
    expect(overlay).toContainElement(screen.getByLabelText('Edit Doc a'));
  });

  it('lets titles wrap: the hero to three desktop lines (its column is mostly air), cards to one', () => {
    render(<Shelf rows={[doc('a', 28), doc('b', 27)]} actions="full" />);
    const hero = screen.getByLabelText('Open Doc a (most recent)');
    expect(hero).toHaveClass('line-clamp-2', 'sm:line-clamp-3');
    const card = screen.getByLabelText('Open Doc b');
    expect(card).toHaveClass('line-clamp-2', 'sm:line-clamp-1');
    for (const link of [hero, card]) {
      // `truncate` sets white-space: nowrap, which would defeat the clamp.
      expect(link).not.toHaveClass('truncate');
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
  });
});

describe('the masthead is proportionate to the screen it is on', () => {
  it('compresses the lockup — small mark, no tagline — instead of stacking the readout under it', () => {
    render(<HeaderBar email="a@b.co" stats={{ total: 2, formats: { markup: 2 } }} />);
    const logo = screen.getByLabelText('artifactbin home').querySelector('img')!;
    expect(logo).toHaveClass('h-8', 'w-8', 'sm:h-20', 'sm:w-20');
    // The tagline is desktop's: for a signed-in phone it is marketing copy
    // spending a line, and beside a small mark it read as one weird run-on.
    expect(screen.getByText('Google Docs for agents')).toHaveClass('hidden', 'sm:block');
    // ONE structure at every size — brand left, readout column right — so the
    // phone is the desktop masthead scaled, not a second layout to maintain.
    const header = screen.getByLabelText('artifactbin home').parentElement!;
    expect(header).toHaveClass('flex', 'items-center', 'justify-between');
  });

  it('keeps the readout an unruled block — no divider band eating vertical space', () => {
    render(<HeaderBar email="a@b.co" stats={{ total: 2, formats: { markup: 2 } }} />);
    const readout = screen.getByLabelText('2 artifacts').closest('div')!;
    expect(readout.className).not.toContain('border-t');
  });

  it('reads the counts as a LEGEND — a colour dot per format, never coloured text', () => {
    // The old readout printed "12 mx-markup" IN the format's hue. mx-markup's
    // hue is pomegranate, so the largest number on the page was red text, and
    // red text in a status line reads as a fault rather than a category. The
    // dot carries the hue; the words stay legible ink.
    render(<HeaderBar email="a@b.co" stats={{ total: 21, formats: { markup: 12, dataset: 9 } }} />);
    const markup = screen.getByLabelText('12 mx-markup');
    expect(markup.style.color).toBe('');
    const dot = markup.querySelector('[data-format-dot]') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.background).toBe('rgb(192, 57, 43)'); // FORMAT_COLORS.markup
  });

  it('leads with the total, so the readout has one thing to land on', () => {
    render(<HeaderBar stats={{ total: 21, formats: { markup: 12 } }} />);
    expect(screen.getByLabelText('21 artifacts')).toHaveTextContent('21');
  });

  it('says only the total on a phone — the format legend is desktop detail', () => {
    // At 390px the legend wrapped into a ragged second line; "21 artifacts"
    // answers the phone's question and the breakdown waits for a screen with
    // room to say it on one line.
    render(<HeaderBar email="a@b.co" stats={{ total: 21, formats: { markup: 12, dataset: 9 } }} />);
    for (const label of ['12 mx-markup', '9 dataset']) {
      expect(screen.getByLabelText(label)).toHaveClass('hidden', 'sm:flex');
    }
    expect(screen.getByLabelText('21 artifacts').className).not.toContain('hidden');
  });

  it('says nothing about counts when the page counted nothing', () => {
    render(<HeaderBar email="a@b.co" />);
    expect(screen.queryByLabelText(/artifacts?$/)).toBeNull();
  });
});

describe('the menu is a sheet on a phone', () => {
  it('opens full width there and keeps the 240px pane on a desktop', () => {
    render(<PageMenu authed />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(screen.getByLabelText('Menu')).toHaveClass('w-full', 'sm:w-72');
  });
});
