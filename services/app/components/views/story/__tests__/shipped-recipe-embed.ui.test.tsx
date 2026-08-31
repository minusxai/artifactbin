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
