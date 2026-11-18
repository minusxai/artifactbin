import { describe, expect, it } from 'vitest';
import { identifySourceElements } from '../index';

describe('identifySourceElements (a draft\'s addressed elements)', () => {
  it('gives every written element an id and its start tag\'s line and column in the source as written', () => {
    const source = '<!doctype html>\n<html><head><title>T</title></head>\n<body>\n  <h1 class="x">Revenue</h1>\n  <af-chart label="Weekly revenue"></af-chart>\n</body></html>';
    const { html, positions } = identifySourceElements(source);
    const ids = [...html.matchAll(/<(\w[\w-]*)[^>]*data-af-id="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(ids.map(([tag]) => tag)).toEqual(['html', 'head', 'title', 'body', 'h1', 'af-chart']);
    const id = (tag: string) => ids.find(([t]) => t === tag)![1]!;
    expect(positions[id('h1')]).toEqual([4, 3]);
    expect(positions[id('af-chart')]).toEqual([5, 3]);
    // Only attributes were added: the author's bytes, line breaks included, are otherwise the same.
    expect(html.replace(/ data-af-id="[^"]+"/g, '')).toBe(source);
  });

  it('keeps an id the author wrote, never mints a taken one, and leaves implied elements and template copies unaddressed', () => {
    const { html, positions } = identifySourceElements('<p data-af-id="af-1">a</p><p data-af-id="af-1">b</p><template><i>t</i></template>');
    expect(positions['af-1']).toEqual([1, 1]);
    // The repeated id is no address; the implied html, head and body get none; the template's content none.
    expect(Object.keys(positions).sort()).toEqual(['af-1', 'af-2']);
    expect(html).toContain('<template data-af-id="af-2"><i>t</i></template>');
    expect(identifySourceElements('<p data-af-id="constructor">x</p>').positions.constructor).toEqual([1, 1]);
  });
});
