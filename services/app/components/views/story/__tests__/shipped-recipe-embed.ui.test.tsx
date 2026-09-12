/**
 * A shipped registry recipe (`recipe: "minusx/trend@1"` — no `ref:`) renders
 * through the SAME envelope path as everything else: QuestionEmbed hands
 * VegaChart a recipe source and resolveEnvelopeSpec materializes it from the
 * registry. Before this existed, a shipped id fell into the `ref:`-only
 * branch and every trend card rendered "recipe unavailable".
 */
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionEmbed from '../QuestionEmbed';

const TABLES = {
  kpi: {
    rows: [
      { period: '2026-06-01', revenue: 90 },
      { period: '2026-06-08', revenue: 120 },
      { period: '2026-06-15', revenue: 160 },
    ],
    columns: [{ name: 'period', type: 'date' as const }, { name: 'revenue', type: 'number' as const }],
  },
};

const VIZ = {
  kind: 'recipe',
  recipe: 'minusx/trend@1',
  bindings: { date: 'period', value: ['revenue'] },
  columnFormats: { revenue: { format: '$,.0f' } },
};

describe('shipped registry recipes in the story embed', () => {
  it('mounts the real chart, not the "recipe unavailable" fallback', async () => {
    const { container, findByLabelText } = renderWithProviders(
      <QuestionEmbed data="$kpi" viz={VIZ} colorMode="light" tables={TABLES} />,
    );
    expect(await findByLabelText('Vega visualization', undefined, { timeout: 15_000 })).toBeTruthy();
    expect(container.textContent).not.toContain('recipe unavailable');
  });
});

/**
 * VegaChart loads through a dynamic boundary (see QuestionEmbed) so readers of
 * chart-free stories never download the vega stack. The boundary must stay
 * invisible to chart embeds: a vega-lite Question still mounts the real chart
 * once the chunk resolves — a botched named-export mapping or a loading state
 * that never settles would strand every chart on its placeholder.
 */
const SALES = {
  sales: {
    rows: [{ month: 'Jan', revenue: 12 }, { month: 'Feb', revenue: 19 }],
    columns: [{ name: 'month', type: 'string' as const }, { name: 'revenue', type: 'number' as const }],
  },
};

const BAR_VIZ = {
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
      <QuestionEmbed data="$sales" viz={BAR_VIZ} colorMode="light" tables={SALES} />,
    );
    // findBy* awaits the dynamic import; the root labeled "Vega visualization"
    // only exists in the real module, so its arrival proves the boundary resolved.
    expect(await findByLabelText('Vega visualization', undefined, { timeout: 15_000 })).toBeTruthy();
  });

  it('keeps non-chart embeds synchronous — a table never waits on vega', () => {
    const { getByLabelText, queryByLabelText } = renderWithProviders(
      <QuestionEmbed data="$sales" viz={{ kind: 'table' }} colorMode="light" tables={SALES} />,
    );
    expect(getByLabelText('Data table')).toBeTruthy();
    expect(queryByLabelText('Chart placeholder')).toBeNull();
  });
});
