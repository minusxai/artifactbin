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
