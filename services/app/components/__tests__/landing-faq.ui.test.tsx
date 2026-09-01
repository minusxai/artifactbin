/**
 * THE ANSWERS ARE THE ARGUMENT, so they must be ON THE PAGE.
 *
 * The obvious FAQ shape is an accordion, and it is the wrong one here: the two
 * questions this section exists for — how this differs from a chat app's
 * artifacts, and why not just write HTML — are the page's positioning, and
 * positioning folded behind a disclosure is positioning most readers never
 * see. So the test asserts every answer is rendered, which is exactly the
 * assertion an accordion would fail.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Landing from '@/components/Landing';
import LandingFaq from '@/components/LandingFaq';
import { QUESTIONS } from '@/lib/landing-content';

describe('the landing FAQ', () => {
  it('renders every question with its answer visible', () => {
    render(<LandingFaq column="" />);
    for (const entry of QUESTIONS) {
      expect(screen.getByText(entry.question)).toBeInTheDocument();
      expect(screen.getByText(entry.answer)).toBeInTheDocument();
    }
  });

  it('is addressable as a section of its own', () => {
    render(<LandingFaq column="" />);
    expect(screen.getByLabelText('Common questions')).toBeInTheDocument();
  });

  it('keeps the set short enough to read standing up', () => {
    expect(QUESTIONS.length).toBeGreaterThan(0);
    expect(QUESTIONS.length).toBeLessThanOrEqual(4);
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
    const faq = screen.getByLabelText('Common questions');
    const footer = screen.getByLabelText('About artifactbin');

    expect(why.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(faq.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
