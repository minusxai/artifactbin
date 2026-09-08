import React from 'react';
import {expect, it} from 'vitest';
import {render, screen} from '@testing-library/react';
import {parseJsx} from '@/lib/jsx';
import {renderStoryNodes} from '../interpreter';

function tree(source: string, values: Record<string, unknown>) {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
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

it('matches JSX numeric short-circuit semantics and fails closed for unknown signals', () => {
  const view = render(tree('<div>{$count && <b>Ready</b>}{$unknown && <i>Unknown</i>}</div>', {count: 0}));
  expect(view.container.textContent).toBe('0');
});
