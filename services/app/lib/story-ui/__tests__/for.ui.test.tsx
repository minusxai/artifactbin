import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseJsx } from '@/lib/jsx';
import { renderStoryNodes } from '../interpreter';

it('repeats keyed signal rows and keeps instance identity on reorder', () => {
  const parsed = parseJsx('<For id="orders" each={$orders} keyBy="order_id"><p id="customer">{$_row.customer}</p></For>');
  if (!parsed.ok) throw new Error(parsed.error);
  const a = {order_id: 'a', customer: 'Alice'}, b = {order_id: 'b', customer: 'Bob'};
  const tree = (orders: unknown[]) => <>{renderStoryNodes(parsed.nodes, {components:{}, values:{orders}})}</>;
  const view = render(tree([a,b]));
  const alice = screen.getByText('Alice');
  const id = alice.getAttribute('data-mx-comment-target');
  expect(id).toBeTruthy();
  expect(alice.getAttribute('data-mx-comment-owner')).toBe('orders');
  view.rerender(tree([b,{...a,customer:'Alicia'}]));
  expect(screen.getByText('Alicia')).toBe(alice);
  expect(alice.getAttribute('data-mx-comment-target')).toBe(id);
  expect(new Set([...view.container.querySelectorAll('[id]')].map(el=>el.id)).size).toBe(view.container.querySelectorAll('[id]').length);
});

it('uses table results, renders empty results and rejects invalid keys visibly', () => {
  const parsed = parseJsx('<For id="orders" each={$orders} keyBy="id"><p id="name">{$_row.name}</p></For>');
  if(!parsed.ok) throw new Error(parsed.error);
  const tree = (rows: Record<string,unknown>[]) => <>{renderStoryNodes(parsed.nodes,{components:{},tables:{orders:{rows}}})}</>;
  const view=render(tree([{id:1,name:'numeric'},{id:'1',name:'string'}]));
  expect(screen.getByText('numeric').id).not.toBe(screen.getByText('string').id);
  view.rerender(tree([])); expect(view.container.textContent).toBe('');
  view.rerender(tree([{id:1},{id:1}])); expect(screen.getByRole('alert').textContent).toContain('duplicate');
  view.rerender(tree([{id:Infinity}])); expect(screen.getByRole('alert').textContent).toContain('non-null');
});

it('rewrites labels and ARIA references per instance while refusing injected handlers and URLs', () => {
  const parsed=parseJsx('<For id="orders" each={$orders} keyBy="id"><label id="label" for="field">Name</label><input id="field" aria-labelledby="label"/><a id="link" href="$_row.url" onclick="bad">Visit</a></For>');
  if(!parsed.ok) throw new Error(parsed.error);
  const view=render(<>{renderStoryNodes(parsed.nodes,{components:{},tables:{orders:{rows:[{id:'a',url:'javascript:alert(1)'},{id:'b',url:'https://example.com'}]}}})}</>);
  const labels=[...view.container.querySelectorAll('label')], fields=[...view.container.querySelectorAll('input')];
  labels.forEach((label,i)=>{expect(label.htmlFor).toBe(fields[i].id);expect(fields[i].getAttribute('aria-labelledby')).toBe(label.id)});
  const links=view.container.querySelectorAll('a');expect(links[0].getAttribute('href')).toBeNull();expect(links[0].getAttribute('onclick')).toBeNull();
  expect(links[1].getAttribute('href')).toBe('https://example.com');
});
