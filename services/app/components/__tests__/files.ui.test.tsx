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

/**
 * THE EMPTY STATE IS A CLAIM, AND IT NEEDS TWO FACTS TO BE TRUE.
 *
 * "Nothing here yet" says the query ANSWERED and answered with nothing. P2
 * shipped the component with only one of those — `rows` — so `undefined` (not
 * asked yet) and `[]` (nothing here) drew the same blank page, and the honest
 * fix is not a longer condition here but the second fact arriving as a prop:
 * `settled`, which the runtime adapter reads off the store's own pending set.
 *
 * Blank while unsettled is PAINT-FIRST, not an oversight: the document arrives
 * at final geometry and the rows land a round trip later, and a folder that
 * flashed "Nothing here yet" on every open would be lying for that round trip.
 */
describe('<Files> with nothing in it', () => {
  const folder = { id: 'vzbd2q', title: 'Field Notes', trail: [] };

  it('says nothing while the query has not answered', () => {
    render(<Files folder={folder} />);
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
  });

  it('says nothing when it is settled and empty and has no folder to name', () => {
    // An authored `<Files data="$q">` in an ordinary document: an empty result
    // is not an empty folder, and there is no id to teach.
    render(<Files rows={[]} settled />);
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
  });

  it('once settled and empty, says so and names both ways to fill it', () => {
    render(<Files rows={[]} settled folder={folder} />);
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    const how = screen.getByText(/Move a document in/);
    expect(how.textContent).toContain('\u22ef menu');
    expect(how.textContent).toContain('parent_id: "vzbd2q"');
  });

  it('drops the empty state the moment there is a row', () => {
    render(<Files rows={rows} settled folder={folder} />);
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
  });
});

/**
 * THE HEAD — what makes a folder page read as a folder rather than as a bare
 * grid. Three facts, all of them the SERVER's (the row's own title, the
 * ancestors this viewer may read, its id), and none of them derivable from the
 * children: a folder with one child and a folder with none must both say where
 * they are.
 */
describe('<Files> head', () => {
  it('names the folder and counts what is in it', () => {
    render(<Files rows={rows} settled folder={{ id: 'vzbd2q', title: 'Field Notes', trail: [] }} />);
    expect(screen.getByText('Field Notes')).toBeTruthy();
    // Three documents and one folder, said as a sentence rather than as a
    // meta string: a dataset is still something you opened the folder to find.
    expect(screen.getByText('3 documents and 1 folder')).toBeTruthy();
  });

  it('draws the trail above the name only when the folder is nested', () => {
    const { container, unmount } = render(
      <Files rows={rows} settled folder={{ id: 'vzbd2q', title: 'Field Notes', trail: [{ id: 'rep001', title: 'Reports', url: '/a/rep001' }] }} />,
    );
    const up = screen.getByLabelText('Up to Reports');
    expect(up.getAttribute('href')).toBe('/a/rep001');
    expect(container.querySelector('[data-slot="files-trail"]')).not.toBeNull();
    unmount();
    render(<Files rows={rows} settled folder={{ id: 'vzbd2q', title: 'Field Notes', trail: [] }} />);
    expect(screen.queryByLabelText(/^Up to /)).toBeNull();
  });

  it('draws no head at all for a listing that is not a folder', () => {
    const { container } = render(<Files rows={rows} settled />);
    expect(container.querySelector('[data-slot="files-head"]')).toBeNull();
  });
});
