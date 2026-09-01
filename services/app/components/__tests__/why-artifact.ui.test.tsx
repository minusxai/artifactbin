/**
 * THE WHY SECTION IS ONE PLATE WITH A KEY. Every claim in REASONS is a numbered
 * entry in the key, every number appears as a pin on the document above it, and
 * the pins are the mapping — so a claim that lost its pin (or a pin nobody
 * claims) is a broken figure, which is what these assert.
 *
 * Reduced motion is stubbed ON: under jsdom the cycle would otherwise run
 * timers forever, and the frozen frame is exactly the one this section must
 * still be legible in — every claim's evidence visible at once.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import WhyArtifact from '../WhyArtifact';
// The plate carries only the claims a mock document can act out.
import { REASONS } from '../../lib/landing-content';

const PLATED = REASONS.filter((r) => r.demo);
import { STORY_THEMES } from '../../lib/data/story/story-themes';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('the why plate', () => {
  it('keys every claim to a numbered pin on the document', () => {
    render(<WhyArtifact />);
    const key = screen.getByLabelText('What the document above demonstrates');
    const plate = screen.getByLabelText('The document these claims are about');
    PLATED.forEach((reason, i) => {
      const entry = within(key).getByRole('listitem', { name: reason.title });
      expect(within(entry).getByText(String(i + 1))).toBeInTheDocument();
      expect(within(entry).getByText(reason.proof)).toBeInTheDocument();
      // The same number, pinned on the document itself — the key's mapping.
      expect(within(plate).getByLabelText(`Pin ${i + 1}: ${reason.title}`)).toBeInTheDocument();
    });
  });

  it('offers every registry theme as a labelled control on the document', () => {
    render(<WhyArtifact />);
    for (const theme of STORY_THEMES) {
      expect(screen.getByLabelText(`Restyle in the ${theme.label} theme`)).toBeInTheDocument();
    }
  });

  it('shows every claim its evidence when motion is off', () => {
    render(<WhyArtifact />);
    // The three that animate in are all present at once in the frozen frame:
    // the corrected number, the resolved thread, and the token saving.
    expect(screen.getByText('24%')).toBeInTheDocument();
    expect(screen.getByText(/resolved/)).toBeInTheDocument();
    expect(screen.getByText(/41,000 saved/)).toBeInTheDocument();
  });
});
