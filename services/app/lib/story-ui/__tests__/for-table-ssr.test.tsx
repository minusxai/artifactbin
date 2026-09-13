/**
 * The server renders the story to HTML and the browser parses it before React hydrates. A `<For>`
 * wrapper `<div>` inside `<tbody>` is not valid there: the HTML parser hoists it out of the table,
 * React hydrates against a different DOM and throws error 418 (eval run 34741910427, pi deck).
 * parse5 follows the same parsing algorithm as the browser, so this proves the served HTML keeps its
 * rows where React expects them, without a browser.
 */
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { renderStoryNodes } from '../interpreter';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

type Node = DefaultTreeAdapterMap['node'];
const names = (node: Node): string[] => ('childNodes' in node ? node.childNodes : []).filter(c => c.nodeName !== '#text').map(c => c.nodeName);

it('a For of table rows survives HTML parsing with its rows inside tbody and nothing hoisted out of the table', () => {
  const parsed = parseJsxOrThrow('<table><tbody><For each={$rows} keyBy="id"><tr><td>{$_row.name}</td></tr></For></tbody></table>');
  const html = renderToStaticMarkup(<>{renderStoryNodes(parsed.nodes, {components:{}, tables:{rows:{rows:[{id:1,name:'a'},{id:2,name:'b'}]}}})}</>);
  const fragment = parseFragment(html);
  expect(names(fragment)).toEqual(['table']);
  const table = fragment.childNodes.find(c => c.nodeName === 'table')!;
  const tbody = ('childNodes' in table ? table.childNodes : []).find(c => c.nodeName === 'tbody')!;
  expect(names(tbody)).toEqual(['tr', 'tr']);
});
