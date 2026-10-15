/**
 * Templates in strings at the publish door: `{$value}` and `{$query.column}` are accepted in any string a
 * reader sees, refused where a value would change identity, executable or compile-time structure, and left
 * literal where the string is not markup at all (SQL bodies, Mermaid code, a script component's data).
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '../parse';
import { validateJsx } from '../validate';
import { templatePosition } from '../template';

const COMPONENTS = ['Isometric', 'Question', 'Card', 'CardTitle', 'Badge', 'Icon', 'DataTable', 'Column', 'Number', 'Grid', 'GridItem', 'Markdown', 'Mermaid', 'Slider', 'Select', 'For', 'Helmet', 'Value', 'Query'];
const messages = (src: string) => {
  const r = parseJsx(src);
  if (!r.ok) throw new Error(r.error);
  return validateJsx(r.nodes, { components: COMPONENTS }).map((e) => e.message);
};

describe('accepted', () => {
  it('reads values and cells in attribute strings, kit text props and chart specs', () => {
    expect(messages(`<a href="https://x.test/{$slug}" title="Open {$name}">x</a>`)).toEqual([]);
    expect(messages(`<div style="width:{$share.pct}%" className="rounded {$tone}" aria-label="{$tiles.label}" />`)).toEqual([]);
    expect(messages(`<Badge className="{$tone}">{$tiles.cheap_v}</Badge>`)).toEqual([]);
    expect(messages(`<Slider label="Year {$year}" value="$year" />`)).toEqual([]);
    expect(messages(`<Question data="$q" title="Score by {$sx}" viz={{"kind":"vega-lite","spec":{"title":"{$sx}","transform":[{"filter":"datum.lang === {$lang}"}]}}} />`)).toEqual([]);
  });
  it('keeps a Mermaid diagram\'s literal `{$` and a script component\'s data as written', () => {
    expect(messages(`<Mermaid code="graph TD; A[{$x}] --> B" />`).some((m) => m.includes('template'))).toBe(false);
  });
});

describe('refused', () => {
  it('names the position for identity, frames and compile-time props', () => {
    for (const [src, fragment] of [
      ['<div id="card-{$x}" />', 'id'],
      ['<iframe src="https://www.youtube.com/embed/{$v}" title="v" />', 'src'],
      ['<Icon name="{$icon}" />', 'name'],
      ['<Badge variant="{$tone}">x</Badge>', 'variant'],
      ['<DataTable data="$q" rowKey="{$k}" />', 'rowKey'],
      ['<Number data="$q" col="{$c}" />', 'col'],
      ['<Grid cols={12} className="{$x}"><GridItem x={0} y={0} w={6} h={2}>a</GridItem></Grid>', 'Grid'],
      ['<Select label="R" value="{$region}" options="$regions" />', 'value'],
      ['<input value="{$x}" />', 'value'],
    ] as const) {
      const found = messages(src);
      expect(found.some((m) => m.includes('{$') && m.includes(fragment)), `${src}: ${found.join(' | ')}`).toBe(true);
    }
  });
  it('refuses templates inside object props other than a chart spec, column specs and style', () => {
    expect(messages(`<DataTable data="$q" columns={[{"col":"a","title":"A {$x}"}]} />`)).toEqual([]);
    expect(messages(`<Question data="$q" viz={{"kind":"recipe","recipe":"minusx/trend@1","params":{"label":"{$x}"}}} />`)).toEqual([]);
    expect(messages(`<Card style={{"width":"{$w}%"}} />`)).toEqual([]);
    expect(messages(`<Isometric parts={[{"key":"{$x}","kind":"slab"}]} />`).some((m) => m.includes('{$') && m.includes('object'))).toBe(true);
  });
  it('says the pipe and calls are not template syntax by leaving them literal, never half-reading them', () => {
    expect(templatePosition('p', 'title', false)).toBe('substitute');
    expect(messages(`<p title="{$x | $,.0f}">x</p>`)).toEqual([]);
  });
});

describe('templatePosition', () => {
  it('is one table: substitute, refuse or literal', () => {
    expect(templatePosition('a', 'href', false)).toBe('substitute');
    expect(templatePosition('div', 'id', false)).toBe('refuse');
    expect(templatePosition('div', 'onClick', false)).toBe('refuse');
    expect(templatePosition('iframe', 'src', false)).toBe('refuse');
    expect(templatePosition('Mermaid', 'code', true)).toBe('literal');
    expect(templatePosition('Query', 'name', true)).toBe('literal');
    expect(templatePosition('Question', 'viz', true)).toBe('substitute');
    expect(templatePosition('Question', 'data', true)).toBe('refuse');
    expect(templatePosition('img', 'src', false)).toBe('literal');
  });
});
