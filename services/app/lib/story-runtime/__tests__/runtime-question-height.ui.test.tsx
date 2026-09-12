/**
 * StoryRuntimeApp — the served document's <Question> heights must follow the SAME sizing
 * contract as the editor canvas (questionEmbedHeightPx). The runtime adapter used to default
 * to 320px with no floor and ignore string heights, so a chart read shorter than it edited.
 */
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { DEFAULT_CHART_H, MIN_CHART_H, SINGLE_VALUE_DEFAULT_H } from '@/lib/data/story/question-height';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

function renderApp(source: string) {
  const parsed = parseJsxOrThrow(source);
  const utils = renderWithProviders(
    <StoryRuntimeApp nodes={parsed.nodes} refData={{}} colorMode="light" chrome={false} />,
  );
  const embed = utils.container.querySelector('[aria-label="Question embed"]') as HTMLElement | null;
  if (!embed) throw new Error('no question embed rendered');
  return embed;
}

describe('StoryRuntimeApp — question embed heights', () => {
  it('missing height renders at the documented default', () => {
    const embed = renderApp('<div><Question data="ref:abc123" /></div>');
    expect(embed.style.height).toBe(`${DEFAULT_CHART_H}px`);
  });

  it('an authored numeric height is honored', () => {
    const embed = renderApp('<div><Question data="ref:abc123" height={500} /></div>');
    expect(embed.style.height).toBe('500px');
  });

  it('an authored STRING height parses instead of falling to the default', () => {
    const embed = renderApp('<div><Question data="ref:abc123" height="500px" /></div>');
    expect(embed.style.height).toBe('500px');
  });

  it('tiny heights clamp to the chart floor', () => {
    const embed = renderApp('<div><Question data="ref:abc123" height={100} /></div>');
    expect(embed.style.height).toBe(`${MIN_CHART_H}px`);
  });

  it('bare single_value embeds take the bare default', () => {
    const embed = renderApp('<div><Question data="ref:abc123" viz={{"kind": "single_value"}} /></div>');
    expect(embed.style.height).toBe(`${SINGLE_VALUE_DEFAULT_H}px`);
  });

  it('inside a GridItem the CELL is the single source of height — the embed fills 100% (canvas contract)', () => {
    const embed = renderApp('<Grid><GridItem x={0} y={0} w={6} h={3}><Question data="ref:abc123" /></GridItem></Grid>');
    expect(embed.style.height).toBe('100%');
  });

  // …and so does a DataTable in a cell: runtime-data-table-height.ui.test.tsx owns that case,
  // next to the rest of the table's own sizing contract.
});
