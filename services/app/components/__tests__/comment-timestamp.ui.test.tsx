import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommentTimestamp } from '../CommentTimestamp';

afterEach(cleanup);

describe('comment timestamps', () => {
  it('shows the year for older comments and exposes the full local timestamp on keyboard focus', async () => {
    const iso = '2020-09-10T14:35:27Z';
    const date = new Date(iso);
    render(<CommentTimestamp iso={iso} />);
    const time = screen.getByLabelText(/2020/);
    expect(time).toHaveAttribute('datetime', iso);
    expect(time.textContent).toMatch(/10 Sept? 2020/);
    expect(time.textContent).toContain(date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
    expect(time).not.toHaveAttribute('title');
    fireEvent.focus(time);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(time.getAttribute('aria-label')!);
  });

  it('omits the redundant year for this year and ignores invalid dates', () => {
    const iso = new Date(new Date().getFullYear(), 5, 10, 14, 35).toISOString();
    const { container, rerender } = render(<CommentTimestamp iso={iso} />);
    expect(container.querySelector('time')!.textContent).toMatch(/^10 Jun · /);
    rerender(<CommentTimestamp iso="invalid" />);
    expect(container.querySelector('time')).toBeNull();
  });
});
