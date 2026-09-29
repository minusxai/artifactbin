/**
 * PHASE 3 PROBE: the framework-free attribute writer (static-solid/attrs `reactAttrs`) against today's
 * `domAttrs` (React's server renderer, parsed back), over every attribute shape `rawBuildProps` can hand it.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reactAttrs, styleText } from '../../static-solid/attrs';
import { rawBuildProps } from '@/lib/story-ui/interpreter';
import { parseJsx, type JsxElement } from '@/lib/jsx';

type Props = Record<string, unknown>;
const domAttrs = (tag: string, props: Props): Array<[string, string]> => {
  const { children: _children, dangerouslySetInnerHTML: _html, ...rest } = props;
  const html = renderToStaticMarkup(createElement(tag, rest)).replace(/^(<link\b[^>]*>)+/, '');
  const start = html.slice(0, html.indexOf('>') + 1);
  return [...start.matchAll(/\s([^\s=/>]+)(?:="([^"]*)")?/g)].map((match) => [match[1]!, (match[2] ?? '')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')]);
};

const SCALARS: unknown[] = ['', 'x', 'a "b" & <c> \'d\'', 0, 1, -1, 2.5, true, false, null, undefined, NaN];
const NAMES = [
  'className', 'htmlFor', 'id', 'title', 'role', 'dir', 'lang', 'tabIndex', 'tabindex', 'width', 'height', 'viewBox', 'href', 'src', 'alt', 'action', 'formAction',
  'data-x', 'data-flag', 'aria-hidden', 'aria-label', 'aria-expanded', 'hidden', 'disabled', 'open', 'readOnly', 'required', 'inert', 'autoFocus', 'multiple', 'muted',
  'contentEditable', 'spellCheck', 'draggable', 'value', 'capture', 'download', 'cols', 'rows', 'size', 'span', 'rowSpan', 'colSpan', 'start', 'strokeWidth', 'stroke-width',
  'fillOpacity', 'clipPath', 'xlinkHref', 'xmlLang', 'crossOrigin', 'unknownThing', 'onClick', 'onclick', 'defaultValue', 'defaultChecked', 'checked', 'selected', 'name',
  'target', 'rel', 'type', 'placeholder', 'min', 'max', 'step', 'colspan', 'datetime', 'itemScope', 'reversed', 'loop', 'controls', 'autoPlay', 'playsInline', 'poster',
];
const TAGS = ['div', 'a', 'input', 'button', 'select', 'option', 'textarea', 'img', 'svg', 'path', 'td', 'ol', 'video', 'details', 'progress', 'li'];

const agree = (tag: string, props: Props) => expect(reactAttrs(tag, props), `${tag} ${JSON.stringify(props)}`).toEqual(domAttrs(tag, props));

describe('reactAttrs writes what React writes', () => {
  it('every name × every scalar, alone, on every tag', () => {
    let cases = 0;
    for (const tag of TAGS) for (const name of NAMES) for (const value of SCALARS) {
      // React refuses an <input> with children; `domAttrs` never passes children.
      agree(tag, { 'data-mx-ast': '0.1', [name]: value, id: 'after' });
      cases++;
    }
    expect(cases).toBe(TAGS.length * NAMES.length * SCALARS.length);
  });

  it('style objects: kebab-case, px, unitless, zero, custom properties, vendor prefixes, drops', () => {
    const styles: Props[] = [
      { minHeight: 1 }, { minHeight: 0 }, { opacity: 0.5, zIndex: 3, lineHeight: 1.4, flexGrow: 1 }, { width: '50%', marginTop: ' 4px ' },
      { '--g-cols': '12', '--g-rh': '86px', '--x': ' spaced ' }, { msTransform: 'none', WebkitLineClamp: 2, MozBoxFlex: 1 },
      { color: null, background: undefined, border: '', outline: true, font: '500 11px/1 var(--font-mono, ui-monospace, monospace)' },
      { content: '"a" & \'b\' <c>' }, { strokeWidth: 2, fillOpacity: 0.3, gridColumn: 2, aspectRatio: 1.5 }, {},
    ];
    for (const style of styles) for (const tag of ['div', 'svg', 'input']) agree(tag, { style, id: 'i' });
    expect(styleText({ minHeight: 1, '--a': '1' })).toBe('min-height:1px;--a:1');
  });

  it('per-element order: input value/checked last, button/form owners last, option selected last', () => {
    agree('input', { value: 'v', type: 'text', checked: true, name: 'n', id: 'i', defaultValue: 'd', formAction: '/x' });
    agree('input', { defaultValue: 'd', defaultChecked: true, type: 'checkbox', 'data-mx-ast': '1' });
    agree('input', { defaultChecked: false, checked: null, value: 0 });
    agree('button', { name: 'b', type: 'submit', formMethod: 'post', id: 'x', formTarget: '_blank' });
    agree('form', { action: '/a', method: 'post', id: 'f', target: 't', encType: 'multipart/form-data' });
    agree('option', { selected: true, value: 'x', id: 'o' });
    agree('select', { value: 'x', defaultValue: 'y', id: 's', multiple: true });
    agree('textarea', { value: 'x', defaultValue: 'y', id: 't', rows: 3 });
    agree('a', { href: '', id: 'a' });
    agree('img', { src: '', alt: '', id: 'm' });
    agree('img', { src: 'https://example.com/a.png', alt: 'a', loading: 'eager' });
    agree('a', { href: 'javascript:alert(1)' });
  });

  it('every prop rawBuildProps derives from authored markup', () => {
    const markup = [
      '<div class="a b" style="margin-top: 4px; --x: 1; -webkit-line-clamp: 2" data-k="v" aria-hidden="true" hidden tabindex="0" title="t \'q\'" />',
      '<label for="i" class="c">L</label>',
      '<input type="checkbox" checked value="on" name="n" disabled required />',
      '<input type="number" value={3} min={0} max={10} step={0.5} readOnly />',
      '<svg viewbox="0 0 10 10" stroke-width="2" strokelinecap="round" fill-opacity={0.5} clip-path="url(#c)"><path d="M0 0" /></svg>',
      '<td colSpan={2} rowspan="3" />', '<ol reversed start={4} />', '<details open />', '<video controls autoPlay muted loop playsInline poster="p.png" />',
      '<a href="#x" target="_blank" rel="noopener" download>d</a>', '<select value="b" multiple />', '<option value="b" selected />', '<textarea value="x" rows={4} cols={0} />',
      '<progress value={40} max={100} />', '<img src="https://e.com/i.png" alt="" width={20} height="10" />', '<div contenteditable spellcheck="false" draggable />',
    ];
    let seen = 0;
    for (const source of markup) {
      const parsed = parseJsx(source) as { nodes: JsxElement[] };
      const node = parsed.nodes[0]!;
      const props = rawBuildProps(node.attributes, false, node.tag, '0', undefined, {});
      agree(node.tag.toLowerCase(), props);
      seen++;
    }
    expect(seen).toBe(markup.length);
  });
});
