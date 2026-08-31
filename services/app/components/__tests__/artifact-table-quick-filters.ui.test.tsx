/**
 * ArtifactTable quick filters: chip toggles under the search bar for the
 * artifact's type and visibility. Multi-select — within a group selections
 * OR together, across groups they AND, and both compose with the search
 * query. A group only renders when the rows actually carry ≥2 distinct
 * values for it, so a single-format list (or token rows with no visibility
 * at all) shows no dead chips.
 *
 * The format group starts with mx-markup PRESSED (documents are the
 * deliverable; datasets/images are their supporting assets) — but only when
 * the group renders and markup rows exist, so an asset-only list is never
 * born empty.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ArtifactTable } from '@/components/TokenBrowser';

let seq = 0;
const row = (over: Partial<Parameters<typeof ArtifactTable>[0]['artifacts'][number]>) => {
  const id = `row${String(seq++).padStart(3, '0')}`;
  return {
    id,
    url: `/a/${id}`,
    title: `Artifact ${id}`,
    format: 'markup',
    version: 1,
    updated_at: '2026-08-10T00:00:00.000Z',
    ...over,
  };
};

const FLEET = [
  row({ title: 'Report', format: 'markup', visibility: 'public' as const }),
  row({ title: 'Deck', format: 'markup', visibility: 'unlisted' as const }),
  row({ title: 'Payroll rows', format: 'dataset', visibility: 'private' as const }),
  row({ title: 'Payroll rows public', format: 'dataset', visibility: 'public' as const }),
  row({ title: 'Logo', format: 'image', visibility: 'public' as const }),
];

const shownTitles = () =>
  screen
    .queryAllByLabelText(/^Open /)
    .map((el) => el.textContent);

afterEach(cleanup);

describe('ArtifactTable quick filters', () => {
  it('renders a chip per format and visibility present; mx-markup starts pressed, filtering the rows', () => {
    render(<ArtifactTable artifacts={FLEET} />);
    expect(screen.getByLabelText('Filter markup').getAttribute('aria-pressed')).toBe('true');
    for (const value of ['dataset', 'image', 'public', 'unlisted', 'private']) {
      const chip = screen.getByLabelText(`Filter ${value}`);
      expect(chip.getAttribute('aria-pressed')).toBe('false');
    }
    expect(shownTitles()).toEqual(['Report', 'Deck']);
    // Only formats present in the list get a chip.
    expect(screen.queryByLabelText('Filter viz')).toBeNull();
  });

  it('unpressing the default markup chip shows everything', () => {
    render(<ArtifactTable artifacts={FLEET} />);
    fireEvent.click(screen.getByLabelText('Filter markup'));
    expect(screen.getByLabelText('Filter markup').getAttribute('aria-pressed')).toBe('false');
    expect(shownTitles()).toHaveLength(FLEET.length);
  });

  it('no default press when the list has no markup rows — an asset list is never born empty', () => {
    render(<ArtifactTable artifacts={FLEET.filter((a) => a.format !== 'markup')} />);
    expect(screen.getByLabelText('Filter dataset').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('Filter image').getAttribute('aria-pressed')).toBe('false');
    expect(shownTitles()).toHaveLength(3);
  });

  it('toggling a format chip filters rows; toggling again clears', () => {
    render(<ArtifactTable artifacts={FLEET} />);
    fireEvent.click(screen.getByLabelText('Filter markup'));
    fireEvent.click(screen.getByLabelText('Filter dataset'));
    expect(screen.getByLabelText('Filter dataset').getAttribute('aria-pressed')).toBe('true');
    expect(shownTitles()).toEqual(['Payroll rows', 'Payroll rows public']);

    fireEvent.click(screen.getByLabelText('Filter dataset'));
    expect(shownTitles()).toHaveLength(FLEET.length);
  });

  it('multi-select within a group ORs values together', () => {
    render(<ArtifactTable artifacts={FLEET} />);
    fireEvent.click(screen.getByLabelText('Filter markup'));
    fireEvent.click(screen.getByLabelText('Filter dataset'));
    fireEvent.click(screen.getByLabelText('Filter image'));
    expect(shownTitles()).toEqual(['Payroll rows', 'Payroll rows public', 'Logo']);
  });

  it('format and visibility groups AND across each other', () => {
    render(<ArtifactTable artifacts={FLEET} />);
    fireEvent.click(screen.getByLabelText('Filter markup'));
    fireEvent.click(screen.getByLabelText('Filter dataset'));
    fireEvent.click(screen.getByLabelText('Filter public'));
    expect(shownTitles()).toEqual(['Payroll rows public']);
  });

  it('chips compose with the search query', () => {
    render(<ArtifactTable artifacts={FLEET} />);
    fireEvent.click(screen.getByLabelText('Filter markup'));
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'payroll' } });
    fireEvent.click(screen.getByLabelText('Filter public'));
    expect(shownTitles()).toEqual(['Payroll rows public']);
  });

  it('shows an empty state when the chips match nothing', () => {
    render(<ArtifactTable artifacts={FLEET.slice(0, 2)} />);
    fireEvent.click(screen.getByLabelText('Filter unlisted'));
    fireEvent.change(screen.getByLabelText('Search artifacts'), { target: { value: 'report' } });
    expect(shownTitles()).toHaveLength(0);
    expect(screen.getByText(/nothing matches/)).toBeTruthy();
  });

  it('hides a group with fewer than two distinct values', () => {
    // All markup + no visibility on any row (logged-out token rows): no chips at all.
    render(
      <ArtifactTable
        artifacts={[row({ title: 'Only', format: 'markup' }), row({ title: 'Other', format: 'markup' })]}
      />,
    );
    expect(screen.queryByLabelText('Filter markup')).toBeNull();
    expect(screen.queryByLabelText('Filter public')).toBeNull();
  });
});
