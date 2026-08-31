/**
 * VegaChart loads through a dynamic boundary (see QuestionEmbed) so readers of
 * chart-free stories never download the vega stack. The boundary must stay
 * invisible to chart embeds: a vega-lite Question still mounts the real chart
 * once the chunk resolves — a botched named-export mapping or a loading state
 * that never settles would strand every chart on its placeholder.
 */
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionEmbed from '../QuestionEmbed';

const TABLES = {
  sales: {
    rows: [{ month: 'Jan', revenue: 12 }, { month: 'Feb', revenue: 19 }],
    columns: [{ name: 'month', type: 'string' as const }, { name: 'revenue', type: 'number' as const }],
  },
};

const VIZ = {
  kind: 'vega-lite',
  spec: {
    mark: 'bar',
    encoding: {
      x: { field: 'month', type: 'nominal' },
      y: { field: 'revenue', type: 'quantitative' },
    },
  },
};

describe('chart embeds across the lazy vega boundary', () => {
  it('mounts the real chart after the chunk resolves', async () => {
    const { findByLabelText } = renderWithProviders(
      <QuestionEmbed data="$sales" viz={VIZ} colorMode="light" tables={TABLES} />,
    );
    // findBy* awaits the dynamic import; the root labeled "Vega visualization"
    // only exists in the real module, so its arrival proves the boundary resolved.
    expect(await findByLabelText('Vega visualization', undefined, { timeout: 15_000 })).toBeTruthy();
  });

  it('keeps non-chart embeds synchronous — a table never waits on vega', () => {
    const { getByLabelText, queryByLabelText } = renderWithProviders(
      <QuestionEmbed data="$sales" viz={{ kind: 'table' }} colorMode="light" tables={TABLES} />,
    );
    expect(getByLabelText('Data table')).toBeTruthy();
    expect(queryByLabelText('Chart placeholder')).toBeNull();
  });
});
