import {expect, it} from 'vitest';
import {act, render, screen} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {hydrateRoot} from 'react-dom/client';
import {renderStoryNodes} from '../interpreter';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

function tree(source: string, values: Record<string, unknown>) {
  const parsed = parseJsxOrThrow(source);
  return <>{renderStoryNodes(parsed.nodes, {components: {}, values})}</>;
}

it('switches nested branches without emitting structural DOM and preserves source paths', () => {
  const source = '{$view === "table" ? <p id="table">Table</p> : <>{$ready && <p id="dag">DAG</p>}</>}';
  const view = render(tree(source, {view: 'table', ready: true}));
  expect(screen.getByText('Table').getAttribute('data-mx-ast')).toBe('0.0.0');
  expect(screen.queryByText('DAG')).toBeNull();
  view.rerender(tree(source, {view: 'dag', ready: true}));
  expect(screen.queryByText('Table')).toBeNull();
  expect(screen.getByText('DAG').getAttribute('data-mx-ast')).toBe('0.1.0.0.0');
  expect(view.container.querySelector('__mx_condition')).toBeNull();
});

it('renders scalar text and updates boolean props, never dynamic URLs or handlers', () => {
  const source = '<button disabled={!$ready}>{$count}</button><div hidden={$ready}>Details</div><a href={$url} onClick={$handler}>Link</a>';
  const view = render(tree(source, {ready: false, count: 2, url: 'javascript:bad()', handler: 'bad'}));
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByRole('button')).toHaveTextContent('2');
  expect(screen.getByText('Link')).not.toHaveAttribute('href');
  expect(screen.getByText('Link')).not.toHaveAttribute('onclick');
  view.rerender(tree(source, {ready: true, count: 4}));
  expect(screen.getByRole('button')).not.toBeDisabled();
  expect(screen.getByText('Details')).toHaveAttribute('hidden');
  expect(screen.getByRole('button')).toHaveTextContent('4');
});

/**
 * A FALSY CONDITION RENDERS NOTHING. JSX's `{0 && <b/>}` prints "0", and SQLite has no boolean: a
 * comparison is 0 or 1. So `{$_row.is_open && <Button/>}` printed a stray "0" on every closed row of
 * the opencode tracker (local eval, 2026-09-27) and the agent spent its last twelve turns on it. A
 * condition is a condition here: false, 0, null and '' all render nothing.
 */
it('renders nothing for a falsy condition, 0 included, and fails closed for unknown signals', () => {
  const view = render(tree('<div>{$count && <b>Ready</b>}{$unknown && <i>Unknown</i>}{!$count && <s>None</s>}</div>', {count: 0}));
  expect(view.container.textContent).toBe('None');
  for (const count of [false, null, '']) {
    view.rerender(tree('<div>{$count && <b>Ready</b>}</div>', {count}));
    expect(view.container.textContent).toBe('');
  }
});

it('a row whose SQLite boolean is 0 renders no "0", and the server and hydrated trees agree', async () => {
  const source = '<ul><For each={$tasks} keyBy="id"><li>{$_row.title}{$_row.is_open && <button>Done</button>}</li></For></ul>';
  const rows = [{id: 1, title: 'Open task', is_open: 1}, {id: 2, title: 'Closed task', is_open: 0}];
  const parsed = parseJsxOrThrow(source);
  const element = <>{renderStoryNodes(parsed.nodes, {components: {}, tables: {tasks: {rows}}})}</>;
  const html = renderToString(element);
  const host = document.createElement('div');
  host.innerHTML = html;
  const items = [...host.querySelectorAll('li')].map(li => li.textContent);
  expect(items).toEqual(['Open taskDone', 'Closed task']);
  const errors: unknown[] = [];
  const root = hydrateRoot(host, element, {onRecoverableError: error => errors.push(error)});
  await act(async () => {});
  expect(errors).toEqual([]);
  expect([...host.querySelectorAll('li')].map(li => li.textContent)).toEqual(items);
  root.unmount();
});
