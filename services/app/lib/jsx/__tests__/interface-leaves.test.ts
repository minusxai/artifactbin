/**
 * lib/jsx's declared leaves, the names not pinned elsewhere: boundaries, comparison props, deck layers, component
 * name sets, reactive expressions and refusals, templates, URL policy helpers, Mermaid keys and the syntax-error
 * brace scanners. Pure.
 */
import { describe, expect, it } from 'vitest';
import { Parser } from 'acorn';
import { BOUNDARY_IDS, isBoundary, mermaidImageKey, mermaidSourceError, GEOMETRY_COLUMN, STORY_COMPONENT_NAMES } from '..';
import { COMPARE_DIRECTIONS, COMPARE_PROPS, GRID_ONLY_PROPS, MAX_COMPARE_ITEMS } from '../comparison';
import { DECK_LAYERS, layerBoundary } from '../deck-spec';
import { kitTextAcceptsLinks, kitTextElement, PERSON_TAGS, PHRASING_COMPONENTS } from '../component-names';
import { isReactiveExpression, reactiveRefusal, REACTIVE_BOOLEAN_PROPS } from '../reactive';
import { expressionHint } from '../parse';
import {
  attributeSignals, holeReader, holeText, isTemplatedObjectProp, parseTemplate, resolveTemplate, STYLE_ATTR_KEY, templateRefusal,
} from '../template';
import { paintHasExternalUrl, SVG_PAINT_ATTRS, URL_LIST_ATTRS, urlListUrls } from '../url-attrs';
import { hasDangerousScheme, listHasDangerousScheme } from '../validate';
import { immutableSet } from '../immutable-set';
import { balancedClose, balancedString, doubleWrapped, extraClosing, tripleOpen } from '../syntax-error';

const expr = (source: string) => Parser.parseExpressionAt(source, 0, { ecmaVersion: 'latest' });

describe('boundaries and deck layers', () => {
  it('accepts exactly the bundled boundary ids', () => {
    expect(BOUNDARY_IDS).toEqual(['us-states', 'us-counties', 'world', 'india-states', 'countries']);
    for (const id of BOUNDARY_IDS) expect(isBoundary(id)).toBe(true);
    for (const id of ['US-States', 'mars', '', null, 1, undefined, 'toString']) expect(isBoundary(id), String(id)).toBe(false);
  });

  it('layerBoundary reads a boundary: data reference, null otherwise', () => {
    expect(layerBoundary({ data: 'boundary:world' })).toBe('world');
    expect(layerBoundary({ data: 'boundary:' })).toBe('');
    expect(layerBoundary({ data: 'world' })).toBeNull();
    expect(layerBoundary({ data: 3 })).toBeNull();
    expect(layerBoundary({})).toBeNull();
  });

  it('every deck layer names its props once, and geometry rides in one column', () => {
    expect(Object.keys(DECK_LAYERS)).toEqual(expect.arrayContaining(['ScatterplotLayer', 'GeoJsonLayer', 'HeatmapLayer']));
    for (const [layer, props] of Object.entries(DECK_LAYERS)) expect(new Set(props).size, layer).toBe(props.length);
    expect(DECK_LAYERS.ScatterplotLayer).toContain('getPosition');
    expect(GEOMETRY_COLUMN).toBe('geometry');
  });
});

describe('comparison', () => {
  it('pins the comparison vocabulary', () => {
    expect(COMPARE_DIRECTIONS).toEqual(['high', 'low']);
    expect(COMPARE_PROPS).toEqual(['header', 'metrics', 'edge']);
    expect(MAX_COMPARE_ITEMS).toBe(6);
    expect(Object.keys(GRID_ONLY_PROPS).sort()).toEqual(['columns', 'rowKey', 'run', 'sort']);
    for (const prop of COMPARE_PROPS) expect(GRID_ONLY_PROPS).not.toHaveProperty(prop);
  });
});

describe('component name sets', () => {
  it('person tags and phrasing components', () => {
    expect([...PERSON_TAGS].sort()).toEqual(['User', 'UserHandle', 'UserImage']);
    for (const tag of PERSON_TAGS) expect(PHRASING_COMPONENTS.has(tag)).toBe(true);
    expect(PHRASING_COMPONENTS.has('Badge')).toBe(true);
    expect(PHRASING_COMPONENTS.has('Card')).toBe(false);
    expect(PHRASING_COMPONENTS.has('DataTable')).toBe(false);
  });

  it('kit text elements, and which of them may carry links', () => {
    expect(kitTextElement('TableCell')).toBe('td');
    expect(kitTextElement('BreadcrumbLink')).toBe('a');
    expect(kitTextElement('Card')).toBeUndefined();
    expect(kitTextElement('toString')).toBeUndefined();
    expect(kitTextAcceptsLinks('CardTitle')).toBe(true);
    expect(kitTextAcceptsLinks('BreadcrumbLink')).toBe(false);
    expect(kitTextAcceptsLinks('Nope')).toBe(false);
  });

  it('keeps the legacy story names only to name their replacement', () => {
    expect(STORY_COMPONENT_NAMES).toContain('Section');
    expect(new Set(STORY_COMPONENT_NAMES).size).toBe(STORY_COMPONENT_NAMES.length);
  });

  it('immutableSet is a set of its values', () => {
    const set = immutableSet(['a', 'b', 'a']);
    expect([...set]).toEqual(['a', 'b']);
    expect(immutableSet([]).size).toBe(0);
  });
});

describe('reactive expressions', () => {
  it('accepts the small serializable vocabulary, and nothing else', () => {
    const signal = { kind: 'signal', name: 'q.total' };
    expect(isReactiveExpression({ kind: 'literal', value: 1 })).toBe(true);
    expect(isReactiveExpression({ kind: 'row', field: 'name' })).toBe(true);
    expect(isReactiveExpression({ kind: 'not', value: signal })).toBe(true);
    expect(isReactiveExpression({ kind: 'binary', op: '===', left: signal, right: { kind: 'literal', value: null } })).toBe(true);
    for (const bad of [
      null, [], { kind: 'literal', value: {} }, { kind: 'literal', value: Infinity }, { kind: 'signal', name: 'a.b.c' }, { kind: 'signal', name: '1a' },
      { kind: 'row', field: 'a.b' }, { kind: 'binary', op: '==', left: signal, right: signal }, { kind: 'call', name: 'f' },
    ]) expect(isReactiveExpression(bad), JSON.stringify(bad)).toBe(false);
  });

  it('refuses nesting past 32 levels', () => {
    let deep: unknown = { kind: 'literal', value: true };
    for (let i = 0; i < 40; i++) deep = { kind: 'not', value: deep };
    expect(isReactiveExpression(deep)).toBe(false);
  });

  it('reactiveRefusal names a loose comparison or a foreign operator, depth first', () => {
    expect(reactiveRefusal(expr('$a == 1'))).toBe('markup compares strictly: write `===` instead of `==`');
    expect(reactiveRefusal(expr('$a != 1'))).toBe('markup compares strictly: write `!==` instead of `!=`');
    expect(reactiveRefusal(expr('$a && ($b + 1 > 2)'))).toMatch(/^`\+` is not a markup operator/);
    expect(reactiveRefusal(expr('$a ? $b ?? 1 : 2'))).toMatch(/`\?\?` is not a markup operator/);
    expect(reactiveRefusal(expr('$a === 1 && !$b'))).toBeNull();
    expect(reactiveRefusal(expr('f($a)'))).toBeNull();
    expect(reactiveRefusal(null)).toBeNull();
  });

  it('expressionHint suffixes the refusal, and says nothing for unparseable or acceptable source', () => {
    expect(expressionHint('$a == 1')).toBe(': markup compares strictly: write `===` instead of `==`');
    expect(expressionHint('$a === 1')).toBe('');
    expect(expressionHint('(((')).toBe('');
  });

  it('names the boolean props a reactive expression may drive', () => {
    for (const prop of ['hidden', 'disabled', 'checked', 'readOnly']) expect(REACTIVE_BOOLEAN_PROPS.has(prop)).toBe(true);
    expect(REACTIVE_BOOLEAN_PROPS.has('className')).toBe(false);
  });
});

describe('templates', () => {
  it('holeText shows scalars, and nothing for null or a non-scalar', () => {
    expect(holeText('é')).toBe('é');
    expect(holeText(0)).toBe('0');
    expect(holeText(false)).toBe('false');
    for (const v of [null, undefined, NaN, Infinity, {}, []]) expect(holeText(v)).toBe('');
  });

  it('resolveTemplate fills every hole, an absent one with nothing', () => {
    const parts = parseTemplate('Hi {$name}, row {$_row.id}: {$q.total}!')!;
    expect(resolveTemplate(parts, holeReader({ name: 'Ada', 'q.total': 3 }, { id: 7 }))).toBe('Hi Ada, row 7: 3!');
    expect(resolveTemplate(parts, holeReader({}))).toBe('Hi , row : !');
    expect(resolveTemplate([], holeReader({}))).toBe('');
    expect(resolveTemplate(['plain'], holeReader({}))).toBe('plain');
  });

  it('isTemplatedObjectProp: style anywhere, a chart spec and table columns on components', () => {
    expect(isTemplatedObjectProp('div', 'style', false)).toBe(true);
    expect(isTemplatedObjectProp('Chart', 'viz', true)).toBe(true);
    expect(isTemplatedObjectProp('DataTable', 'columns', true)).toBe(true);
    expect(isTemplatedObjectProp('Chart', 'viz', false)).toBe(false);
    expect(isTemplatedObjectProp('DataTable', 'viz', true)).toBe(false);
  });

  it('attributeSignals reads holes only where a position substitutes', () => {
    expect(attributeSignals('p', 'title', false, 'Hi {$name} {$name}')).toEqual(['name']);
    expect(attributeSignals('Chart', 'viz', true, { spec: { title: '{$q.total}' } })).toEqual(['q.total']);
    expect(attributeSignals('p', 'id', false, '{$name}')).toEqual([]);
    expect(attributeSignals('Value', 'default', true, '{$name}')).toEqual([]);
    expect(attributeSignals('p', 'title', false, 42)).toEqual([]);
    expect(STYLE_ATTR_KEY).toBe('attr:style');
  });

  it.each([
    ['p', 'id', false, '"id" is the element\'s identity'],
    ['p', 'onClick', false, 'handlers are never markup'],
    ['iframe', 'src', false, 'a frame loads exactly the https page written'],
    ['Grid', 'cols', true, '<Grid> is laid out when the page is published'],
    ['Select', 'value', true, '"value" binds a declared name: write "$name"'],
    ['input', 'checked', false, '"checked" binds a declared name: write "$name"'],
    ['Icon', 'name', true, '<Icon name> is read when the page is published'],
  ] as const)('templateRefusal(%s, %s)', (tag, attr, isComponent, why) => {
    expect(templateRefusal(tag, attr, isComponent)).toBe(why);
  });
});

describe('URL policy helpers', () => {
  it('names the URL list and SVG paint attributes', () => {
    expect([...URL_LIST_ATTRS]).toEqual(['srcset', 'ping']);
    for (const attr of ['fill', 'clip-path', 'clippath', 'marker-end']) expect(SVG_PAINT_ATTRS.has(attr)).toBe(true);
    expect(SVG_PAINT_ATTRS.has('d')).toBe(false);
  });

  it('urlListUrls splits ping on whitespace and srcset on commas, dropping descriptors', () => {
    expect(urlListUrls(' https://a.test/x,y \n https://b.test ', 'ping')).toEqual(['https://a.test/x,y', 'https://b.test']);
    expect(urlListUrls('a.png 1x, b.png 2x,, c.png', 'srcset')).toEqual(['a.png', 'b.png', 'c.png']);
    expect(urlListUrls('', 'srcset')).toEqual([]);
  });

  it('hasDangerousScheme normalizes the way browsers do, and lets safe data images through', () => {
    for (const url of ['javascript:alert(1)', 'JAVASCRIPT:x', 'java\tscript:x', ' \x01javascript:x', 'vbscript:x']) expect(hasDangerousScheme(url), JSON.stringify(url)).toBe(true);
    for (const url of ['https://a.test', '/relative', '#frag', 'mailto:a@b.test', 'data:image/png;base64,AA']) expect(hasDangerousScheme(url), url).toBe(false);
  });

  it('listHasDangerousScheme checks every entry of a list attribute', () => {
    expect(listHasDangerousScheme('a.png 1x, javascript:x 2x', 'srcset')).toBe(true);
    expect(listHasDangerousScheme('https://a.test javascript:x', 'ping')).toBe(true);
    expect(listHasDangerousScheme('a.png 1x, b.png 2x', 'srcset')).toBe(false);
    expect(listHasDangerousScheme('', 'ping')).toBe(false);
  });

  it('paintHasExternalUrl: only a local #fragment paint reference is allowed', () => {
    expect(paintHasExternalUrl('url(#grad)')).toBe(false);
    expect(paintHasExternalUrl('red')).toBe(false);
    expect(paintHasExternalUrl('url(https://evil.test/x.svg#a)')).toBe(true);
    expect(paintHasExternalUrl('url(#ok) url(other.svg#a)')).toBe(true);
  });
});

describe('Mermaid source', () => {
  it('mermaidSourceError refuses empty, oversized and configured code', () => {
    expect(mermaidSourceError('graph TD; A-->B')).toBeNull();
    expect(mermaidSourceError('')).toMatch(/nonempty static code/);
    expect(mermaidSourceError('   ')).toMatch(/nonempty/);
    expect(mermaidSourceError(3)).toMatch(/nonempty/);
    expect(mermaidSourceError('---\ntitle: x\n---\ngraph TD')).toMatch(/frontmatter/);
    expect(mermaidSourceError('%%{init: {}}%%\ngraph TD')).toMatch(/directives/);
    expect(mermaidSourceError('graph TD\n' + 'A-->B\n'.repeat(100_000))).toMatch(/exceeds/);
  });

  it('mermaidImageKey is deterministic per code and colour mode', () => {
    const key = mermaidImageKey('graph TD; A-->B', 'light');
    expect(key).toMatch(/^light-[0-9a-f]{32}$/);
    expect(mermaidImageKey('graph TD; A-->B', 'light')).toBe(key);
    expect(mermaidImageKey('graph TD; A-->B', 'dark')).toBe(key.replace('light', 'dark'));
    expect(mermaidImageKey('graph TD; A-->C', 'light')).not.toBe(key);
    expect(mermaidImageKey('', 'dark')).toMatch(/^dark-[0-9a-f]{32}$/);
  });
});

describe('syntax-error brace scanners', () => {
  it('balancedClose counts braces and skips strings', () => {
    expect(balancedClose('{a{b}"}"}', 0)).toBe(8);
    expect(balancedClose('x={`}`}', 2)).toBe(6);
    expect(balancedClose('{"\\""}', 0)).toBe(5);
    expect(balancedClose('{{}', 0)).toBe(-1);
    expect(balancedClose('', 0)).toBe(-1);
  });

  it('balancedString finds the closing quote past escapes', () => {
    expect(balancedString('"a\\"b"', 0)).toBe(5);
    expect(balancedString("'é'", 0)).toBe(2);
    expect(balancedString('"never', 0)).toBe(-1);
  });

  it('extraClosing names stray closing braces after an attribute expression', () => {
    expect(extraClosing('<Chart viz={{"a":1}}} />')).toMatchObject({ attr: 'viz', line: 1, extra: 1 });
    expect(extraClosing('<p\n title={"x"}}} />')).toMatchObject({ attr: 'title', line: 2, extra: 2 });
    expect(extraClosing('<Chart viz={{"a":1}} />')).toBeNull();
    expect(extraClosing('')).toBeNull();
  });

  it('tripleOpen names an attribute opened with three braces', () => {
    expect(tripleOpen('<Chart viz={{{"a":1}}} />')?.[1]).toBe('viz');
    expect(tripleOpen('<Chart viz={{"a":1}} />')).toBeNull();
  });

  it('doubleWrapped spots attr={{…}} around a non-object, and leaves an object alone', () => {
    const array = '<Select options={{["a","b"]}} />';
    expect(doubleWrapped(array)).toMatchObject({ attr: 'options', line: 1, open: array.indexOf('{{'), inner: array.indexOf('{{') + 1, close: array.lastIndexOf('}}') });
    expect(doubleWrapped('<p\n hidden={{true}} />')).toMatchObject({ attr: 'hidden', line: 2 });
    expect(doubleWrapped('<p title={{"text"}} />')).toMatchObject({ attr: 'title' });
    expect(doubleWrapped('<p style={{"color":"red"}} />')).toBeNull();
    expect(doubleWrapped('<p style={{color:"red"}} />')).toBeNull();
    expect(doubleWrapped('<p x={{')).toBeNull();
  });
});
