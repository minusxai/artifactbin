/**
 * CLOSED, BUT NEVER ABSENT.
 *
 * The four questions start shut, so the section reads as a short list rather
 * than a page of prose. The risk that buys is what these tests pin: two of the
 * four answers ARE the page's positioning (why not a chat app's artifacts
 * panel, why not just write the HTML), and an accordion that MOUNTS an answer
 * only once it is opened spends them — the text is then absent for
 * find-in-page, for a crawler, and for anyone reading the page as text.
 *
 * Native <details> is what avoids that, and the assertions are written so a
 * later "improvement" to a JS accordion fails loudly: every answer is IN the
 * document while every disclosure is SHUT.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Landing from '@/components/Landing';
import LandingFaq from '@/components/LandingFaq';
import { QUESTIONS } from '@/lib/landing-content';

const disclosures = (container: HTMLElement) => Array.from(container.querySelectorAll('details'));

describe('the landing FAQ', () => {
  it('starts with every question shut', () => {
    const { container } = render(<LandingFaq column="" />);
    const items = disclosures(container);

    expect(items).toHaveLength(QUESTIONS.length);
    for (const item of items) expect(item.open).toBe(false);
  });

  it('keeps every answer in the page while it is shut, so the argument is never absent', () => {
    render(<LandingFaq column="" />);
    for (const entry of QUESTIONS) {
      expect(screen.getByText(entry.question)).toBeInTheDocument();
      expect(screen.getByText(entry.answer)).toBeInTheDocument();
    }
  });

  it('opens a question when its summary is clicked', () => {
    const { container } = render(<LandingFaq column="" />);
    const [first] = disclosures(container);

    fireEvent.click(screen.getByText(QUESTIONS[0].question));
    expect(first.open).toBe(true);
  });

  it('is addressable as a section of its own', () => {
    render(<LandingFaq column="" />);
    expect(screen.getByLabelText('FAQs')).toBeInTheDocument();
  });

  it('keeps the set short enough to read standing up', () => {
    expect(QUESTIONS.length).toBeGreaterThan(0);
    expect(QUESTIONS.length).toBeLessThanOrEqual(5);
    for (const entry of QUESTIONS) {
      expect(entry.question.endsWith('?')).toBe(true);
      expect(entry.answer.length).toBeGreaterThan(40);
    }
  });
});

/**
 * WHERE IT SITS IS PART OF THE ARGUMENT. The questions answer the claims band
 * directly above them ("why not a chat app's artifacts", after six reasons to
 * use this one), so the order is the reasoning and a later layout edit must not
 * quietly float the section somewhere else on the page.
 */
describe('the FAQ on the landing page', () => {
  it('follows the claims band and precedes the footer', () => {
    render(<Landing />);
    const why = screen.getByLabelText('Why artifactbin');
    const faq = screen.getByLabelText('FAQs');
    const footer = screen.getByLabelText('About artifactbin');

    expect(why.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(faq.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
