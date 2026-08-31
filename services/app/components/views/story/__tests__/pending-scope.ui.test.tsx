/**
 * "Loading" is a claim about ONE chart's table, not the document's.
 *
 * The flag started life document-wide, which was right when the only pending
 * state was the initial resolve of everything the document declared. A value
 * change re-runs only the queries that bind it: one re-run is in flight, and
 * every OTHER unresolved chart on the page must not announce itself as loading
 * — including charts whose query genuinely failed, which would then read
 * "loading…" forever from the reader's point of view.
 *
 * Both directions are wrong and both are silent, so both are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import QuestionEmbed from '../QuestionEmbed';

const base = {
  viz: undefined, colorMode: 'light' as const, tables: {}, tableErrors: {},
};
const render = (props: Partial<React.ComponentProps<typeof QuestionEmbed>>) =>
  renderWithProviders(<QuestionEmbed {...base} data="$mine" {...props} />);

const ROWS = { rows: [{ a: 1 }], columns: [{ name: 'a', type: 'number' as const }] };

describe('which chart gets to say "loading"', () => {
  it('says loading while ITS OWN table is in flight', () => {
    const { getByLabelText } = render({ pendingTables: ['mine'] });
    expect(getByLabelText('Chart placeholder').textContent).toMatch(/loading/i);
  });

  it('does NOT say loading because a DIFFERENT table is loading', () => {
    // The rebind case: another embed just got bound to `other`.
    const { getByLabelText } = render({ pendingTables: ['other'] });
    expect(getByLabelText('Chart placeholder').textContent).toMatch(/unavailable/i);
  });

  it('reports a table with no rows yet as unavailable, not loading', () => {
    const { getByLabelText } = render({ pendingTables: [] });
    expect(getByLabelText('Chart placeholder').textContent).toMatch(/unavailable/i);
  });

  it('names the failure of ITS OWN query', () => {
    const { getByLabelText } = render({ tableErrors: { mine: 'Binder Error: no such column' } });
    expect(getByLabelText('Chart placeholder').textContent).toMatch(/query "mine" failed.*Binder Error/);
  });

  it('resolved data wins over any pending claim (stale rows stay, no flash)', () => {
    const { queryByLabelText } = render({ tables: { mine: ROWS }, pendingTables: ['mine'] });
    expect(queryByLabelText('Chart placeholder')).toBeNull();
  });

  it('accepts the pending set as a Set too (the store hands one)', () => {
    const { getByLabelText } = render({ pendingTables: new Set(['mine']) });
    expect(getByLabelText('Chart placeholder').textContent).toMatch(/loading/i);
  });
});
