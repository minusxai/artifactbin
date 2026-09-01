/**
 * THE FOOTER'S CALL TO ACTION IS THE ACTION, not a scroll back to it. It was
 * `<a href="#top">create an artifact</a>` — a reader who got all the way to
 * the bottom, decided, and clicked, was sent back to the top of the page to
 * find the real button. Both surfaces now run the SAME AgentLink: one
 * implementation of "mint a document and copy the instruction", so the two
 * cannot drift into meaning different things.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingFooter from '@/components/LandingFooter';

describe('the landing footer', () => {
  it('mints a document rather than scrolling back to the top', () => {
    const { container } = render(<LandingFooter column="" />);
    expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
    expect(container.querySelector('a[href="#top"]')).toBeNull();
  });

  it('keeps the demo link beside it', () => {
    render(<LandingFooter column="" />);
    expect(screen.getByText('book a demo')).toBeInTheDocument();
  });
});
