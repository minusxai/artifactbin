/** P2 (seeded RED) — `<Files>`: card where a thumbnail exists, a format glyph where it does not, numbers only when present. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Files } from '@/components/kit/files';

afterEach(cleanup);
const rows = [
  { id: 'doc001', title: 'Board update', format: 'markup', level: 1, visibility: 'public', updated_at: '2026-09-05T10:00:00Z', url: '/a/doc001', thumbnail: '/a/doc001/export?mode=card&v=3', views: 41, sparkline: '0,1,3,2' },
  { id: 'doc002', title: 'Hiring plan', format: 'markup', level: 1, visibility: 'private', updated_at: '2026-09-04T10:00:00Z', url: '/a/doc002', thumbnail: null, views: 12, sparkline: '1,1,4,2' },
  { id: 'sub001', title: 'Q3', format: 'folder', level: 1, visibility: 'public', updated_at: '2026-09-03T10:00:00Z', url: '/a/sub001', thumbnail: null, views: null, sparkline: null },
  { id: 'ds0001', title: 'Sales', format: 'dataset', level: 1, visibility: 'public', updated_at: '2026-09-02T10:00:00Z', url: '/a/ds0001', thumbnail: null, views: null, sparkline: null },
];

describe('<Files>', () => {
  it('draws the card for a row with a thumbnail and a format glyph for one without', () => {
    render(<Files rows={rows} />);
    const card = screen.getByLabelText('Open Board update');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/a/doc001/export?mode=card&v=3');
    expect(screen.getByLabelText('Open Hiring plan').querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Open Hiring plan').querySelector('[data-glyph="markup"]')).not.toBeNull();
    expect(screen.getByLabelText('Open Q3').querySelector('[data-glyph="folder"]')).not.toBeNull();
    expect(screen.getByLabelText('Open Sales').querySelector('[data-glyph="dataset"]')).not.toBeNull();
    expect(screen.getByLabelText('Open Q3').getAttribute('href')).toBe('/a/sub001');
  });

  it('shows the view count and a sparkline only where views is a number', () => {
    render(<Files rows={rows} />);
    expect(screen.getByLabelText('41 views')).toBeTruthy();
    expect(screen.getByLabelText('Open Board update').querySelector('svg[data-sparkline]')).not.toBeNull();
    // SEED CORRECTION (P2): the line here asked queryByLabelText for a regex two
    // rows match, which throws "Found multiple elements" — both children carry a
    // number, and a mark per row is the point. Asserted as what it meant: every
    // row the server counted gets one, and no row it did not.
    expect(screen.getAllByLabelText(/^\d+ views$/).map((n) => n.getAttribute('aria-label'))).toEqual(['41 views', '12 views']);
    expect(screen.getByLabelText('Open Q3').querySelector('svg[data-sparkline]')).toBeNull();
    expect(screen.getByLabelText('Open Q3').textContent).not.toMatch(/views/);
  });

  it('variant is a density switch and a capture draws glyphs only', () => {
    const { container, unmount } = render(<Files rows={rows} variant="icons" />);
    expect(container.querySelector('[data-variant="icons"]')).not.toBeNull();
    unmount();
    render(<Files rows={rows} variant="icons" capture />);
    expect(screen.getByLabelText('Open Board update').querySelector('img')).toBeNull();
    expect(screen.getByLabelText('Open Board update').querySelector('[data-glyph="markup"]')).not.toBeNull();
  });

  it('renders nothing but the container while the rows have not arrived', () => {
    const { container } = render(<Files />);
    expect(container.querySelectorAll('a').length).toBe(0);
  });
});
