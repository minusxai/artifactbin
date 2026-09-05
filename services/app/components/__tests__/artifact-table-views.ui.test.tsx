/**
 * ArtifactTable views column (dashboard only): each managed row shows its
 * view count over the server-rendered spline. Desktop and mobile use the same
 * views mark at different widths; the logged-out token browser passes no
 * views, so no column or mobile mark appears.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ArtifactTable } from '@/components/TokenBrowser';

describe('ArtifactTable — the views column follows the DATA, not the permission', () => {
  const bare = { id: 'aa', url: '/a/aa', title: 'Bare', format: 'markup', version: 1, updated_at: '2026-08-20T00:00:00.000Z' };

  it('reserves no views column when no row carries a count', () => {
    render(<ArtifactTable artifacts={[bare]} manage />);
    expect(screen.queryByText('views')).toBeNull();
    expect(screen.queryByLabelText('Bare views')).toBeNull();
  });

  it('shows it as soon as the page supplies one, permission unchanged', () => {
    render(<ArtifactTable artifacts={[{ ...bare, views: 12 }]} />);
    expect(screen.getAllByLabelText('Bare views')).toHaveLength(2);
    for (const mark of screen.getAllByLabelText('Bare views')) expect(mark).toHaveTextContent('12 views');
  });

  it('can withhold the editor while still offering the link', () => {
    render(<ArtifactTable artifacts={[bare]} canEdit={false} />);
    expect(screen.getByRole('link', { name: 'Open Bare' })).toHaveAttribute('href', '/a/aa');
    expect(screen.queryByLabelText('Edit Bare')).toBeNull();
  });
});

describe('ArtifactTable — a row shows what the document looks like', () => {
  it('carries a thumbnail beside the title, so the list is scannable by sight', () => {
    render(
      <ArtifactTable
        artifacts={[{ id: 'aa', url: '/a/aa', title: 'Thumbed', format: 'markup', version: 4, updated_at: '2026-08-20T00:00:00.000Z' }]}
      />,
    );
    const row = screen.getByLabelText('Open Thumbed').closest('tr')!;
    const img = row.querySelector('img');
    expect(img?.getAttribute('src')).toContain('/a/aa/export');
    // Version-busted, so an edit shows a new picture rather than a stale one.
    expect(img?.getAttribute('src')).toContain('v=4');
  });
});

const row = (views?: number, sparkline?: string) => [
  {
    id: 'row000',
    url: '/a/row000',
    title: 'Artifact 0',
    format: 'markup',
    version: 1,
    updated_at: '2026-08-10T00:00:00.000Z',
    ...(views !== undefined ? { views } : {}),
    ...(sparkline !== undefined ? { sparkline } : {}),
  },
];

describe('ArtifactTable views column', () => {
  it('shows the count and the spline on managed rows', () => {
    render(<ArtifactTable manage artifacts={row(3, '<svg data-testid="spark"></svg>')} />);
    const marks = screen.getAllByLabelText('Artifact 0 views');
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark).toHaveTextContent('3 views');
      expect(mark.querySelector('svg')).toHaveAttribute('preserveAspectRatio', 'none');
      expect(mark.lastElementChild).toHaveClass('bg-surface/55', 'z-[1]');
    }
    const desktop = marks.find((mark) => !mark.closest('.mt-1'))!;
    const mobile = marks.find((mark) => mark.closest('.mt-1'))!;
    expect(desktop.closest('td')).toHaveClass('hidden', 'sm:table-cell');
    expect(screen.getByLabelText('Open Artifact 0')).toHaveClass('font-semibold', 'flex-1');
    expect(mobile.closest('.mt-1')).toHaveClass('sm:hidden');
  });

  it('renders zero views without a spline', () => {
    render(<ArtifactTable manage artifacts={row(0)} />);
    const marks = screen.getAllByLabelText('Artifact 0 views');
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark).toHaveTextContent('0 views');
      expect(mark.querySelector('svg')).toBeNull();
    }
  });

  // WAS: "has no views column outside manage mode". The column used to be
  // gated on the owner's PERMISSION, which conflated two questions — may this
  // viewer manage the row, and did the page even count. Profiles need the
  // second answered "no" while the first is irrelevant, so the gate moved to
  // the DATA: a row carrying a count renders it, a row without one reserves
  // nothing. The absence case is asserted at the top of this file.
  it('shows a count the page supplied even when the viewer cannot manage', () => {
    render(<ArtifactTable artifacts={row(3)} />);
    for (const mark of screen.getAllByLabelText('Artifact 0 views')) expect(mark).toHaveTextContent('3 views');
  });
});
