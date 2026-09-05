/** The real dashboard-to-Vega boundary, without mocking the chart renderer. */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Dashboard from '@/components/Dashboard';
import type { ShelfRow } from '@/components/Shelf';

const row = (id: string, format: string, views: number): ShelfRow => ({
  id,
  url: `/a/${id}`,
  title: id,
  format,
  version: 1,
  visibility: 'public',
  updated_at: '2026-09-05T00:00:00.000Z',
  views,
});

describe('Dashboard', () => {
  it('counts document and data tiers separately and mounts the interactive Vega chart', async () => {
    render(
      <Dashboard
        rows={[row('document', 'markup', 1267), row('dataset', 'dataset', 99), row('image', 'image', 41), row('folder', 'folder', 0)]}
        viewsOverTime={[0, 2, 5]}
        likes={3}
        likesOverTime={[0, 1, 2]}
        followers={4}
        forks={5}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Dashboard' });
    expect(heading.querySelector('svg')).toBeTruthy();
    expect(screen.queryByText('Your artifacts')).toBeNull();
    const metrics = within(screen.getByLabelText('Dashboard metrics'));
    const valueFor = (label: string) => metrics.getByText(label).closest('dt')?.nextElementSibling;
    expect(valueFor('artifacts')).toHaveTextContent('1');
    expect(valueFor('assets')).toHaveTextContent('2');
    expect(valueFor('views')).toHaveTextContent('1.2k');
    expect(valueFor('views')).toHaveAttribute('title', '1,267 views');
    expect(valueFor('likes')).toHaveTextContent('3');
    expect(valueFor('followers')).toHaveTextContent('4');
    expect(valueFor('forks')).toHaveTextContent('5');
    for (const label of ['artifacts', 'assets', 'views', 'likes', 'followers', 'forks']) {
      expect(metrics.getByText(label).closest('dt')?.querySelector('svg')).toBeTruthy();
    }

    const chart = await screen.findByLabelText('Engagement Vega chart', undefined, { timeout: 15_000 });
    await waitFor(() => expect(chart.querySelector('svg')).toBeTruthy(), { timeout: 15_000 });
    expect(chart.parentElement?.parentElement).toHaveClass('h-[14.25rem]');
    expect(screen.queryByLabelText('Vega chart error')).toBeNull();
    expect(screen.getByText('click a line or legend to focus · double-click to reset')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Expand dashboard'));
    const dialog = screen.getByRole('dialog', { name: 'Expanded dashboard' });
    const expandedMetrics = within(within(dialog).getByLabelText('Expanded dashboard metrics'));
    expect(expandedMetrics.getByText('1.2k')).toHaveAttribute('title', '1,267 views');
    expect(within(dialog).getByText('Engagement over time')).toBeTruthy();
    expect(await within(dialog).findByLabelText('Expanded engagement Vega chart', undefined, { timeout: 15_000 })).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText('Close expanded dashboard'));
    expect(screen.queryByRole('dialog', { name: 'Expanded dashboard' })).toBeNull();
  });
});
