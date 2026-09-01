/**
 * THE RAIL IS NAVIGATION, NOT A CAPTION. It names the range and marks where
 * the wheel has got to — and a reader who reads "Decks" and wants the deck
 * should be able to say so, rather than waiting for the rotation to arrive
 * there. Clicking a format scrolls the wheel to the first document of that
 * kind, on the same path a dot or an arrow uses, so the three controls can
 * never disagree about where the carousel is.
 */
import { fireEvent, render, screen } from '@testing-library/react';
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
    fireEvent.click(screen.getByLabelText('Show Decks'));
    const marked = [...document.querySelectorAll('[aria-current="true"]')].map((e) => e.textContent);
    expect(marked).toEqual(['Decks']);
  });
});
