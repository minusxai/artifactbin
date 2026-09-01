/**
 * THE RAIL IS NAVIGATION, NOT A CAPTION. It names the range and marks where
 * the wheel has got to — and a reader who reads "Decks" and wants the deck
 * should be able to say so, rather than waiting for the rotation to arrive
 * there. Clicking a format scrolls the wheel to the first document of that
 * kind, on the same path a dot or an arrow uses, so the three controls can
 * never disagree about where the carousel is.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UseCarousel from '@/components/UseCarousel';
import { SHOWCASE, SHOWCASE_FORMATS } from '@/lib/showcase';

const centred = () => document.querySelector('[data-use-row][data-state="in"]')?.textContent;

describe('the format rail', () => {
  it('scrolls the wheel to the first document of the kind clicked', () => {
    render(<UseCarousel />);
    for (const format of SHOWCASE_FORMATS) {
      fireEvent.click(screen.getByLabelText(`Show ${format.label}`));
      const expected = SHOWCASE.find((doc) => doc.kind === format.kind);
      expect(centred(), format.label).toBe(expected?.use);
    }
  });

  it('marks the kind the wheel is on, and only that one', () => {
    render(<UseCarousel />);
    const last = SHOWCASE_FORMATS[SHOWCASE_FORMATS.length - 1];
    fireEvent.click(screen.getByLabelText(`Show ${last.label}`));
    const marked = [...document.querySelectorAll('[aria-current="true"]')].map((e) => e.textContent);
    expect(marked).toEqual([last.label]);
  });
});

/**
 * THE WHEEL TURNS ONE WAY. Its position used to be DERIVED from which
 * document is showing (`centre = N + active`), so the step from the last
 * document to the first was a position going backwards — and the reader
 * watched half a second of the whole list rewinding past them, once a lap.
 * A rolodex does not do that: it keeps turning and the list comes round.
 */
describe('the wheel', () => {
  const track = () => document.querySelector('.use-wheel') as HTMLElement;
  /** The row the track is parked on, read out of its own transform. */
  const row = () => Number(/-1 \* (-?\d+) \*/.exec(track().style.transform)![1]);
  const N = SHOWCASE.length;
  /** One step forward, with the frame the re-seat needs. */
  const next = async () => {
    fireEvent.click(screen.getByLabelText('Next example'));
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
  };

  /**
   * A row delta alone cannot tell the two apart — the rewind moved the track
   * -(N-1) rows and the re-seat-then-move lands on the same number. What
   * separates them is whether the reader SEES it: the rewind animated across
   * the whole list, the re-seat is painted with the transition suppressed and
   * lands on the same document. So the contract is about the paint, not the
   * arithmetic: an ANIMATED change is always exactly one row, and a suppressed
   * one is always a whole copy of the list.
   */
  it('only ever animates one row at a time', async () => {
    render(<UseCarousel />);
    const states = [{ row: row(), suppressed: false }];
    for (let i = 0; i < N * 3; i += 1) {
      fireEvent.click(screen.getByLabelText('Next example'));
      states.push({ row: row(), suppressed: track().style.transition === 'none' });
      await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
      states.push({ row: row(), suppressed: track().style.transition === 'none' });
    }
    for (let i = 1; i < states.length; i += 1) {
      const delta = states[i].row - states[i - 1].row;
      const where = `paint ${i} of ${JSON.stringify(states.map((s) => (s.suppressed ? `[${s.row}]` : s.row)))}`;
      if (states[i].suppressed) expect(Math.abs(delta % N), where).toBe(0);
      else expect([0, 1], where).toContain(delta);
    }
  });

  it('stays inside the rendered rows however long it runs', async () => {
    render(<UseCarousel />);
    for (let i = 0; i < N * 4; i += 1) await next();
    expect(row()).toBeGreaterThanOrEqual(0);
    expect(row()).toBeLessThan(N * 3);
  });

  it('comes round to the first document after a full lap', async () => {
    render(<UseCarousel />);
    const first = centred();
    for (let i = 0; i < N; i += 1) await next();
    expect(centred()).toBe(first);
  });
});
