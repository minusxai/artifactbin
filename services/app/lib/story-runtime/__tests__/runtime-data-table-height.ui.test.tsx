/**
 * The served document's <DataTable> height is a CEILING, on the SAME path a reader
 * gets: StoryRuntimeApp's DataTableAdapter. Phase 1 made the kit's scroll box
 * `max-height`, but the adapter still wrapped it in a div with a definite height
 * (`questionEmbedHeightPx`, floored at MIN_CHART_H), so a three-row table kept
 * reserving 420px — production eval run 33702277600. The wrapper must carry no
 * height outside a grid cell, and the cap must be the TABLE parser's (no chart floor).
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import type { StoryIslandDataflow } from '../contract';
import type { DataflowState } from '@/lib/story/dataflow';

const HELMET = '<Helmet><Query name="sales">{`select * from ref_abc123`}</Query></Helmet>';

const STATE: DataflowState = {
  values: {},
  tables: {
    sales: {
      rows: [{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1200 }, { region: 'APAC', revenue: 300 }],
      columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }],
    },
  },
  errors: {},
};

function renderBody(body: string) {
  const parsed = parseJsx(HELMET + body);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  const dataflow: StoryIslandDataflow = { flow: { values: content.values, queries: content.queries }, state: STATE };
  const { container } = renderWithProviders(
    <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />,
  );
  const embed = container.querySelector('[aria-label="DataTable embed"]') as HTMLElement;
  if (!embed) throw new Error('no DataTable embed rendered');
  const box = embed.querySelector('[data-slot="data-table"] > div') as HTMLElement | null;
  return { embed, box };
}

describe('StoryRuntimeApp — DataTable height is a ceiling', () => {
  it('outside a grid the wrapper reserves NOTHING: no height, the kit caps at the default 420', () => {
    const { embed, box } = renderBody('<div><DataTable data="$sales" /></div>');
    expect(embed.style.height).toBe('');
    expect(box?.style.maxHeight).toBe('420px');
    expect(box?.style.height).toBe('');
  });

  it('an authored height is the cap ITSELF — the 340px chart floor is not a table rule', () => {
    const { embed, box } = renderBody('<div><DataTable data="$sales" height="120px" /></div>');
    expect(embed.style.height).toBe('');
    expect(box?.style.maxHeight).toBe('120px');
  });

  it('a numeric authored height caps the same way', () => {
    const { box } = renderBody('<div><DataTable data="$sales" height={250} /></div>');
    expect(box?.style.maxHeight).toBe('250px');
  });

  it('inside a GridItem the CELL is the single source of height — the embed still fills 100%', () => {
    const { embed } = renderBody('<Grid><GridItem x={0} y={0} w={12} h={4}><DataTable data="$sales" /></GridItem></Grid>');
    expect(embed.style.height).toBe('100%');
  });

  it('the unresolved-data box reserves nothing either, outside a cell', () => {
    const { embed } = renderBody('<div><DataTable data="$missing" /></div>');
    expect(embed.style.height).toBe('');
  });
});
