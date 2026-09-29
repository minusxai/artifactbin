/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import Dashboard from '@/solid/components/Dashboard';

afterEach(cleanup);

it('preserves the account metrics and engagement chart in the Home rail', () => {
  render(() => <Dashboard
    rows={[{ id: 'a', format: 'markup', views: 7 }, { id: 'data', format: 'dataset', views: 99 }] as never}
    stats={{ artifacts: 1004, assets: 204, views: 1234 }}
    viewsOverTime={[0, 2, 5]}
    likes={3}
    likesOverTime={[0, 1, 2]}
    followers={4}
    forks={2}
  />);
  const dashboard = screen.getByLabelText('Dashboard');
  const metrics = within(screen.getByLabelText('Dashboard metrics'));
  const valueFor = (label: string) => metrics.getByText(label).closest('dt')?.nextElementSibling;
  expect(valueFor('artifacts')).toHaveTextContent('1k');
  expect(valueFor('assets')).toHaveTextContent('204');
  expect(valueFor('views')).toHaveTextContent('1.2k');
  expect(valueFor('likes')).toHaveTextContent('3');
  expect(valueFor('followers')).toHaveTextContent('4');
  expect(valueFor('forks')).toHaveTextContent('2');
  expect(dashboard).toHaveTextContent('Engagement over time');
  expect(screen.getByRole('group', { name: 'Interactive engagement chart: 7 views and 3 likes in the last 30 days' })).toBeInTheDocument();
  expect(screen.getByLabelText('Engagement Vega chart')).toBeInTheDocument();
});
