/* @jsxImportSource solid-js */
/** The link card under the caret: a link's actions, and the address box ⌘K opens. */
import { screen, fireEvent } from '@testing-library/dom';
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from '@/solid/__tests__/helpers';
import { LinkCard } from '../LinkCard';

const at = { x: 40, y: 100, width: 60, height: 18 };

function Harness(props: { href: string | null; editing?: boolean; onApply?: (href: string | null) => void; onCancel?: () => void }) {
  const [editing, setEditing] = createSignal(!!props.editing);
  return <LinkCard at={at} href={props.href} editing={editing()} onEdit={() => setEditing(true)}
    onApply={(href) => { setEditing(false); props.onApply?.(href); }} onCancel={() => { setEditing(false); props.onCancel?.(); }} onDismiss={() => setEditing(false)} />;
}

it('shows the link with Open, Edit and Remove, just under the caret', () => {
  const onApply = vi.fn();
  render(() => <Harness href="https://example.com/guide" onApply={onApply} />);
  const open = screen.getByRole('link', { name: /example\.com\/guide/ });
  expect(open.getAttribute('target')).toBe('_blank');
  expect(open.getAttribute('rel')).toContain('noopener');
  const card = screen.getByRole('group', { name: 'Link' });
  expect(card.style.top).toBe(`${at.y + at.height + 6}px`);
  fireEvent.click(screen.getByLabelText('Remove link'));
  expect(onApply).toHaveBeenCalledWith(null);
});

it('edits the address: prefilled, applied on Enter, refused when it is not one, cancelled with Escape', async () => {
  const onApply = vi.fn(), onCancel = vi.fn();
  render(() => <Harness href="https://example.com" onApply={onApply} onCancel={onCancel} />);
  fireEvent.click(screen.getByLabelText('Edit link'));
  const input = screen.getByLabelText('Link URL') as HTMLInputElement;
  expect(input.value).toBe('https://example.com');
  fireEvent.input(input, { target: { value: 'javascript:alert(1)' } });
  fireEvent.submit(input.closest('form')!);
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('web address');
  fireEvent.input(input, { target: { value: 'example.org/docs' } });
  fireEvent.submit(input.closest('form')!);
  expect(onApply).toHaveBeenCalledWith('example.org/docs');
  fireEvent.click(screen.getByLabelText('Edit link'));
  fireEvent.keyDown(screen.getByLabelText('Link URL'), { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Link URL')).toBeNull();
});

it('opens empty for new text, and an emptied address removes the link', () => {
  const onApply = vi.fn();
  render(() => <Harness href={null} editing onApply={onApply} />);
  const input = screen.getByLabelText('Link URL') as HTMLInputElement;
  expect(input.value).toBe('');
  fireEvent.submit(input.closest('form')!);
  expect(onApply).toHaveBeenCalledWith(null);
});
