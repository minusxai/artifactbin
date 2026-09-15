/** Native disclosures keep answers available to readers and crawlers while closed. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
