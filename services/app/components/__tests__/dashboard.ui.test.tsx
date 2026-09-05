/** The real dashboard-to-Vega boundary, without mocking the chart renderer. */
import { render, screen, waitFor, within } from '@testing-library/react';
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
        rows={[row('document', 'markup', 7), row('dataset', 'dataset', 99), row('image', 'image', 41), row('folder', 'folder', 0)]}
        viewsOverTime={[0, 2, 5]}
        likes={3}
        likesOverTime={[0, 1, 2]}
        followers={4}
        forks={5}
      />,
    );

    const metrics = within(screen.getByLabelText('Dashboard metrics'));
    expect(metrics.getByText('artifacts').nextElementSibling).toHaveTextContent('1');
    expect(metrics.getByText('data files').nextElementSibling).toHaveTextContent('2');
    expect(metrics.getByText('views').nextElementSibling).toHaveTextContent('7');
    expect(metrics.getByText('likes').nextElementSibling).toHaveTextContent('3');
    expect(metrics.getByText('followers').nextElementSibling).toHaveTextContent('4');
    expect(metrics.getByText('forks').nextElementSibling).toHaveTextContent('5');
    for (const label of ['artifacts', 'data files', 'views', 'likes', 'followers', 'forks']) {
      expect(metrics.getByText(label).closest('dt')?.querySelector('svg')).toBeTruthy();
    }

    const chart = await screen.findByLabelText('Engagement Vega chart', undefined, { timeout: 15_000 });
    await waitFor(() => expect(chart.querySelector('svg')).toBeTruthy(), { timeout: 15_000 });
    expect(chart.parentElement?.parentElement).toHaveClass('h-[14.25rem]');
    expect(screen.queryByLabelText('Vega chart error')).toBeNull();
    expect(screen.getByText('click a line or legend to focus · double-click to reset')).toBeTruthy();
  });
});
