import { describe, expect, it } from 'vitest';
import {
  deepHasValueHole, deepTemplateSignals, fillTemplate, hasValueHole, holeReader, parseTemplate, specDigest, substituteViz, templateSignals,
} from '../template';
import { resolveAttribute, resolveAttributes } from '../template-attrs';

const read = (signals: Record<string, unknown>, row?: Record<string, unknown>) => holeReader(signals, row);

describe('parseTemplate', () => {
  it('splits values, query cells, built-ins and row fields; leaves everything else literal', () => {
    expect(parseTemplate('Revenue in {$region} ({ $tiles.cheap_v }) by {$_me.id} for {$_row.name}')).toEqual([
      'Revenue in ', { kind: 'signal', name: 'region' }, ' (', { kind: 'signal', name: 'tiles.cheap_v' }, ') by ',
      { kind: 'signal', name: '_me.id' }, ' for ', { kind: 'row', field: 'name' },
    ]);
    for (const literal of ['plain', '$region', '{region}', '{$_row}', '{$a.b.c}', '{$x | $,.0f}', '{$f()}', '$,.0f', 5, null]) {
      expect(parseTemplate(literal)).toBeNull();
    }
  });
  it('names what a string reads, and tells page reads from row-only templates', () => {
    expect(templateSignals('{$a} {$q.c} {$a} {$_row.x}')).toEqual(['a', 'q.c']);
    expect(hasValueHole('{$_row.x}')).toBe(false);
    expect(hasValueHole('w-{$_row.x} {$size}')).toBe(true);
    const viz = { kind: 'vega-lite', spec: { title: 'By {$sx}', transform: [{ filter: 'datum.l === {$lang}' }], encoding: { x: { field: 'x' } } } };
    expect(deepHasValueHole(viz)).toBe(true);
    expect(deepHasValueHole({ spec: { title: 'static' } })).toBe(false);
    expect(deepTemplateSignals(viz)).toEqual(['sx', 'lang']);
  });
});

describe('fillTemplate', () => {
  it('fills values, first-row cells and row fields; an absent value is nothing; never reads prototypes', () => {
    const signals = { region: 'West', 'tiles.cheap_v': 3.5, flag: true };
    expect(fillTemplate('{$region}: {$tiles.cheap_v} {$flag} [{$missing}] {$_row.n}', read(signals, { n: 7 }))).toBe('West: 3.5 true [] 7');
    expect(fillTemplate('{$constructor}{$_row.toString}', read({}, {}))).toBe('');
    expect(fillTemplate('{$obj}', read({ obj: { a: 1 } }))).toBe('');
  });
});

describe('resolveAttribute guards', () => {
  it('drops a URL attribute that resolves to a dangerous scheme or has an empty hole', () => {
    for (const link of ['javascript:alert(1)', ' JaVa\tScRiPt:alert(1)', 'vbscript:x', 'data:text/html,<script>1</script>']) {
      expect(resolveAttribute('href', '{$link}', read({ link }))).toBeNull();
      expect(resolveAttribute('xlink:href', '{$link}', read({ link }))).toBeNull();
    }
    expect(resolveAttribute('srcset', '{$a} 1x, {$b} 2x', read({ a: '/x.png', b: 'javascript:alert(1)' }))).toBeNull();
    expect(resolveAttribute('href', '/r/{$id}', read({ id: '' }))).toBeNull();
    expect(resolveAttribute('href', 'https://x.test/{$id}?q={$q}', read({ id: 'a b', q: 2 }))).toBe('https://x.test/a b?q=2');
    expect(resolveAttribute('src', '{$img}', read({ img: 'data:image/png;base64,AA' }))).toBe('data:image/png;base64,AA');
  });
  it('never substitutes a style value that could end the declaration or fetch', () => {
    expect(resolveAttribute('style', 'color:{$c}', read({ c: 'red;background:url(https://x)' }))).toBe('color:');
    for (const c of ['url(https://x)', 'x}body{color:red', 'a\\62 c', '"x"', "'x'", 'red\nbackground:blue', 'image-set("x" 1x)', 'red/*', '@import x']) {
      expect(resolveAttribute('style', 'color:{$c}', read({ c }))).toBe('color:');
    }
    expect(resolveAttribute('style', 'width:{$w}%;color:{$c}', read({ w: 42.5, c: 'rgb(1, 2, 3)' }))).toBe('width:42.5%;color:rgb(1, 2, 3)');
  });
  it('keeps SVG paint references local and never templates id', () => {
    expect(resolveAttribute('fill', 'url({$p})', read({ p: 'https://x.test/a.svg#g' }))).toBeNull();
    expect(resolveAttribute('fill', 'url(#{$p})', read({ p: 'grad' }))).toBe('url(#grad)');
    expect(resolveAttribute('id', 'card-{$x}', read({ x: 'a' }))).toBe('card-{$x}');
  });
  it('resolves an element\'s attributes at once, leaving out the dropped ones', () => {
    expect(resolveAttributes({ href: '{$l}', title: 'For {$r}', class: 'w-{$s}' }, read({ l: 'javascript:alert(1)', r: 'West', s: 4 }))).toEqual({ title: 'For West', class: 'w-4' });
  });
});

describe('substituteViz', () => {
  const viz = {
    kind: 'vega-lite',
    spec: {
      title: 'Score by {$sx}',
      transform: [{ filter: 'datum.lang === {$lang}' }, { calculate: 'datum.v * {$scale}', as: 'w' }],
      encoding: { x: { field: 'x', axis: { format: '{$fmt}', title: '{$meta.x_title}' } }, y: { scale: { domain: [0, '{$max}'] } } },
      layer: [{ mark: { type: 'rule' }, encoding: { color: { condition: { test: 'datum.name === {$pick}', value: 'red' } } } }],
    },
  };
  it('fills text leaves, quotes holes in expression leaves, keeps a lone hole\'s type', () => {
    const out = substituteViz(viz, read({ sx: 'Time', lang: 'ru"st', scale: 2, fmt: '$,.0f', 'meta.x_title': 'Hours', max: 40, pick: null }));
    expect(out.spec.title).toBe('Score by Time');
    expect(out.spec.transform[0]).toEqual({ filter: 'datum.lang === "ru\\"st"' });
    expect(out.spec.transform[1]).toEqual({ calculate: 'datum.v * 2', as: 'w' });
    expect(out.spec.encoding.x.axis).toEqual({ format: '$,.0f', title: 'Hours' });
    expect(out.spec.encoding.y.scale.domain).toEqual([0, 40]);
    expect(out.spec.layer[0]!.encoding.color.condition.test).toBe('datum.name === null');
  });
  it('returns an untemplated spec as the same object', () => {
    const plain = { kind: 'vega-lite', spec: { title: 'x' } };
    expect(substituteViz(plain, read({}))).toBe(plain);
  });
  it('digests the resolved spec, so two values never share a drawing', () => {
    const a = substituteViz(viz, read({ sx: 'Cost' })), b = substituteViz(viz, read({ sx: 'Time' }));
    expect(specDigest(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(specDigest(a)).not.toBe(specDigest(b));
    expect(specDigest(a)).toBe(specDigest(JSON.parse(JSON.stringify(a))));
  });
});
