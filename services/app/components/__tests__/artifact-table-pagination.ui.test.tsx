/**
 * ArtifactTable pagination.
 *
 * The table rendered every row, so an account with a dozen artifacts pushed the
 * pro tip (and anything else below it) off the screen entirely — the list grew
 * without bound while the page around it stayed fixed. Five rows, then a pager.
 *
 * The sharp edge is the interaction with search: a filter narrows the result set
 * under a page cursor that was set against the old one, so page 3 of 12 becomes
 * page 3 of 1 — an empty table with rows that do match. The cursor must clamp.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ArtifactTable, ARTIFACTS_PER_PAGE } from '@/components/TokenBrowser';

const make = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `row${String(i).padStart(3, '0')}`,
    url: `/a/row${String(i).padStart(3, '0')}`,
    title: `Artifact ${i}`,
    format: 'markup',
    version: 1,
    updated_at: '2026-08-10T00:00:00.000Z',
  }));

const titles = () =>
  screen
    .getAllByRole('link', { name: /^Open Artifact/ })
    .map((el) => el.getAttribute('aria-label')?.replace('Open ', ''));

describe('ArtifactTable pagination', () => {
  // The row's two links address the artifact by its ONE id: the server-supplied
  // url for reading, `/a/<id>#edit` (built here) for editing. Nothing derives a
  // second identifier from either.
  it('addresses each row by its id', () => {
    render(<ArtifactTable artifacts={make(1)} />);
    expect(screen.getByLabelText('Open Artifact 0')).toHaveAttribute('href', '/a/row000');
    expect(screen.getByLabelText('Edit Artifact 0')).toHaveAttribute('href', '/a/row000#edit');
  });

  it('shows at most one page of rows', () => {
    render(<ArtifactTable artifacts={make(12)} />);
    expect(ARTIFACTS_PER_PAGE).toBe(5);
    expect(titles()).toEqual(['Artifact 0', 'Artifact 1', 'Artifact 2', 'Artifact 3', 'Artifact 4']);
  });

  it('walks forward and back through the pages', () => {
    render(<ArtifactTable artifacts={make(12)} />);
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(titles()).toEqual(['Artifact 5', 'Artifact 6', 'Artifact 7', 'Artifact 8', 'Artifact 9']);
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(titles()).toEqual(['Artifact 10', 'Artifact 11']); // short last page
    fireEvent.click(screen.getByLabelText('Previous page'));
    expect(titles()).toEqual(['Artifact 5', 'Artifact 6', 'Artifact 7', 'Artifact 8', 'Artifact 9']);
  });

  it('stops at both ends', () => {
    render(<ArtifactTable artifacts={make(12)} />);
    expect(screen.getByLabelText('Previous page')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Next page'));
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByLabelText('Next page')).toBeDisabled();
  });

  it('never paginates a list that fits', () => {
    render(<ArtifactTable artifacts={make(ARTIFACTS_PER_PAGE)} />);
    expect(screen.queryByLabelText('Next page')).toBeNull();
  });

  it('does not strand the cursor past the end of a filtered list', () => {
    render(<ArtifactTable artifacts={make(12)} />);
    fireEvent.click(screen.getByLabelText('Next page'));
    fireEvent.click(screen.getByLabelText('Next page')); // page 3
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'Artifact 1' } });
    // 'Artifact 1', 'Artifact 10', 'Artifact 11' match — one page's worth, so the
    // stale cursor must fall back to it rather than showing nothing.
    expect(titles()).toEqual(['Artifact 1', 'Artifact 10', 'Artifact 11']);
  });

  it('counts the whole list, not just the page', () => {
    render(<ArtifactTable artifacts={make(12)} />);
    expect(screen.getByLabelText('Page range').textContent).toBe('1-5 of 12');
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByLabelText('Page range').textContent).toBe('6-10 of 12');
  });
});
