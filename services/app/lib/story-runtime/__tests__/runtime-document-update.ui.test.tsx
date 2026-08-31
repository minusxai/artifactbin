/**
 * The served document ADOPTS a new version of itself — it is not reloaded.
 *
 * An agent writing to a document someone is reading used to reach them (when it
 * reached them at all) as a fresh iframe: the whole document re-fetched,
 * re-parsed, re-hydrated, every chart rebuilt, the reader's scroll position and
 * their `<Value>` selections gone. The document is a React tree; a new version
 * of it is a re-render of that tree.
 *
 * What must survive: the DOM of everything that did not change, the reader's
 * own state in the store, and — the part positional keys got wrong — the nodes
 * that merely SHIFTED because something above them was removed.
 */
import React, { act } from 'react';
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore, type DataflowStore } from '../store';
import type { StoryIslandDataflow } from '../contract';
import type { DataflowState } from '@/lib/story/dataflow';

const HELMET =
  '<Helmet>'
  + '<Value name="region" type="string" />'
  + '<Query name="sales">{`select region, sum(revenue) revenue from ref_abc123 group by 1`}</Query>'
  + '</Helmet>';

const STATE: DataflowState = {
  values: { region: null },
  tables: {
    sales: {
      rows: [{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1200 }],
      columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }],
    },
  },
  errors: {},
};

function build(body: string) {
  const parsed = parseJsx(HELMET + body);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  const dataflow: StoryIslandDataflow = { flow: { values: content.values, queries: content.queries }, state: STATE };
  return { nodes, dataflow };
}

const doc = (lede: string, withBeta = true) =>
  '<div>'
  + '<h1 aria-label="head">Title</h1>'
  + `<p aria-label="lede">${lede}</p>`
  + (withBeta ? '<p aria-label="beta">beta</p>' : '')
  + '<Question data="$sales" viz={{"kind":"table"}} height="300px" />'
  + '<p aria-label="tail">gamma</p>'
  + '</div>';

/** Mount a document and return the handles a later version is judged against. */
async function mount(source: string) {
  const first = build(source);
  const store: DataflowStore = createDataflowStore(first.dataflow);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<StoryRuntimeApp nodes={first.nodes} refData={{}} dataflow={first.dataflow} colorMode="light" chrome={false} store={store} />);
  });
  const adopt = async (nextSource: string) => {
    const next = build(nextSource);
    await act(async () => {
      root.render(<StoryRuntimeApp nodes={next.nodes} refData={{}} dataflow={next.dataflow} colorMode="light" chrome={false} store={store} />);
    });
  };
  const at = (label: string) => host.querySelector(`[aria-label="${label}"]`);
  return { host, store, adopt, at, embed: () => host.querySelector('[aria-label="Question embed"]') };
}

describe('StoryRuntimeApp — adopting a new document', () => {
  it('a TEXT change: the text updates and nothing else is rebuilt', async () => {
    const d = await mount(doc('alpha'));
    const head = d.at('head');
    const tail = d.at('tail');
    const embed = d.embed();

    await d.adopt(doc('ALPHA REWRITTEN'));

    expect(d.at('lede')!.textContent).toBe('ALPHA REWRITTEN');
    expect(d.at('head')).toBe(head);
    expect(d.at('tail')).toBe(tail);
    expect(d.embed()).toBe(embed);
  });

  it("keeps the reader's own values across an adopt", async () => {
    const d = await mount(doc('alpha'));
    await act(async () => { d.store.setValue('region', 'NA'); });
    await d.adopt(doc('ALPHA REWRITTEN'));
    expect(d.store.getValue('region')).toBe('NA');
  });

  it('a STRUCTURAL change: what merely shifted keeps its DOM, including the embed', async () => {
    const d = await mount(doc('alpha'));
    const head = d.at('head');
    const tail = d.at('tail');
    const embed = d.embed();

    await d.adopt(doc('alpha', false)); // the beta paragraph is gone; everything after renumbers

    expect(d.at('beta')).toBeNull();
    expect(d.at('head')).toBe(head);
    expect(d.at('tail')).toBe(tail);
    expect(d.embed()).toBe(embed);
  });
});
