/**
 * BOUND IMAGE SOURCES at runtime — `<img src="$pick">` and the braced form.
 *
 * Publish imports the URLs it can SEE. A URL that only exists once a reader has
 * picked something is imported on FIRST VIEW by the document's own asset
 * endpoint, and mapped by the same pure function the server uses. Three rules
 * are load-bearing here and each is asserted:
 *
 *  - the first render of a URL nobody has answered yet is the ENDPOINT address,
 *    on BOTH ends of the wire — the island carries no asset lookup, so any
 *    server-side knowledge of what is cached would be a hydration mismatch;
 *  - a URL the browser has already loaded is remembered, so coming back to it
 *    renders `/assets/<hash>` and costs no second endpoint request;
 *  - a refused URL is MARKED (`data-mx-asset="refused"`) and left without a
 *    src, which is how the browser draws the alt text.
 */
import React from 'react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import type { StoryIslandDataflow } from '../contract';
import type { DataflowState } from '@/lib/story/dataflow';
import { urlHash } from '@/lib/story/asset-url';

const CAT = 'https://cdn.example.com/cat.png';
const DOG = 'https://cdn.example.com/dog.png';
const ASSETS_URL = '/a/abc123/assets';
const endpointFor = (url: string) => `${ASSETS_URL}?u=${encodeURIComponent(url)}`;

const HELMET =
  '<Helmet>'
  + '<Value name="pick" type="string" default="https://cdn.example.com/cat.png" />'
  + '<Value name="key" type="string" default="cat" />'
  + '<Value name="empty" type="string" />'
  + '</Helmet>';

const state = (values: Record<string, string | null>): DataflowState => ({ values, tables: {}, errors: {} });

function build(body: string, values: Record<string, string | null>) {
  const parsed = parseJsx(HELMET + body);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  const dataflow: StoryIslandDataflow = { flow: { values: content.values, queries: content.queries }, state: state(values) };
  return { nodes, dataflow };
}

const app = (body: string, values: Record<string, string | null>) => {
  const { nodes, dataflow } = build(body, values);
  return (
    <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" assetsUrl={ASSETS_URL} />
  );
};

const img = (container: HTMLElement) => container.querySelector('img')!;

describe('a bound <img src>', () => {
  it('renders the document asset endpoint for the bound value, keeping everything else the author wrote', () => {
    const { container } = render(app('<img src="$pick" alt="the pick" class="rounded" />', { pick: CAT }));
    expect(img(container).getAttribute('src')).toBe(endpointFor(CAT));
    expect(img(container).getAttribute('alt')).toBe('the pick');
    expect(img(container).className).toContain('rounded');
    // The reference itself must never reach the DOM.
    expect(container.innerHTML).not.toContain('$pick');
  });

  it('resolves the braced form against the same values', () => {
    const { container } = render(app('<img src="https://cdn.example.com/{$key}.png" alt="a" />', { key: 'cat' }));
    expect(img(container).getAttribute('src')).toBe(endpointFor(CAT));
  });

  it('has no src at all when the value is null — the alt text is the placeholder', () => {
    const { container } = render(app('<img src="$empty" alt="nothing chosen" />', { empty: null }));
    expect(img(container).hasAttribute('src')).toBe(false);
    expect(img(container).getAttribute('alt')).toBe('nothing chosen');
    expect(img(container).getAttribute('data-mx-bound')).toBe('src:$empty');
  });

  it('SERVER and CLIENT render the identical src — the island carries no asset lookup', () => {
    const html = renderToString(app('<img src="$pick" alt="a" />', { pick: CAT }));
    expect(html).toContain(endpointFor(CAT).replace(/&/g, '&amp;'));
    const { container } = render(app('<img src="$pick" alt="a" />', { pick: CAT }));
    expect(img(container).getAttribute('src')).toBe(endpointFor(CAT));
  });
});

describe('what the browser has already loaded', () => {
  it('goes straight to /assets/<hash> the second time a URL is shown, and never back to the endpoint', () => {
    const { nodes, dataflow } = build('<img src="$pick" alt="a" /><select value="$pick"><option value="' + CAT + '">cat</option><option value="' + DOG + '">dog</option></select>', { pick: CAT });
    const { container, rerender } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" assetsUrl={ASSETS_URL} />,
    );
    expect(img(container).getAttribute('src')).toBe(endpointFor(CAT));
    // The browser answered it: the runtime remembers the URL is held.
    act(() => { fireEvent.load(img(container)); });
    const select = container.querySelector('select')!;
    act(() => { fireEvent.change(select, { target: { value: DOG } }); });
    expect(img(container).getAttribute('src')).toBe(endpointFor(DOG));
    act(() => { fireEvent.load(img(container)); });
    act(() => { fireEvent.change(select, { target: { value: CAT } }); });
    expect(img(container).getAttribute('src')).toBe(`/assets/${urlHash(CAT)}`);
    rerender(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" assetsUrl={ASSETS_URL} />);
  });
});

describe('a refused URL', () => {
  it('is marked and left without a src, so the alt text stands in for it', () => {
    const { container } = render(app('<img src="$pick" alt="could not load" />', { pick: CAT }));
    act(() => { fireEvent.error(img(container)); });
    expect(img(container).getAttribute('data-mx-asset')).toBe('refused');
    expect(img(container).hasAttribute('src')).toBe(false);
    expect(img(container).getAttribute('alt')).toBe('could not load');
  });
});

describe('with no endpoint (a render that is not a served document)', () => {
  it('renders the bound image static — no src, the binding named', () => {
    const { nodes, dataflow } = build('<img src="$pick" alt="a" />', { pick: CAT });
    const { container } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" />);
    expect(img(container).hasAttribute('src')).toBe(false);
    expect(img(container).getAttribute('data-mx-bound')).toBe('src:$pick');
  });
});

/**
 * A COLUMN OF IMAGE URLS goes through exactly the same path — the author says
 * `kind: "image"` and the cell renders an `<img>` mapped to our own copy. A
 * plain URL column stays text, because a column of links is what a URL column
 * usually is.
 */
describe('a DataTable image column', () => {
  const TABLE_HELMET =
    '<Helmet><Value name="rows" type="table" value={[{"name":"cat","logo":"https://cdn.example.com/cat.png"}]} /></Helmet>';

  const table = (columns: string) => {
    const parsed = parseJsx(`${TABLE_HELMET}<DataTable data="$rows" columns={${columns}} />`);
    if (!parsed.ok) throw new Error(parsed.error);
    const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
    const dataflow: StoryIslandDataflow = {
      flow: { values: content.values, queries: content.queries },
      state: {
        values: {},
        tables: { rows: { rows: [{ name: 'cat', logo: CAT }], columns: [{ name: 'name', type: 'string' }, { name: 'logo', type: 'string' }] } },
        errors: {},
      },
    };
    return <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" assetsUrl={ASSETS_URL} />;
  };

  it('renders the cell as an image through the document asset endpoint', () => {
    const { container } = render(table('[{"col":"name"},{"col":"logo","kind":"image"}]'));
    const cell = container.querySelector('td img');
    expect(cell).not.toBeNull();
    expect(cell!.getAttribute('src')).toBe(endpointFor(CAT));
  });

  it('leaves a plain URL column as text', () => {
    const { container } = render(table('[{"col":"logo"}]'));
    expect(container.querySelector('td img')).toBeNull();
    expect(container.textContent).toContain(CAT);
  });
});
