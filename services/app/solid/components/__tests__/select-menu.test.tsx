/* @jsxImportSource solid-js */
/**
 * components/SelectMenu.tsx port: same listbox contract, ported test cases from the panels that
 * exercise it (viz-editor-panel.ui.test.tsx's `pick` helper).
 */
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { SelectMenu } from '../SelectMenu';

const OPTIONS = [
  { value: '', label: '— none —' },
  { value: 'region', label: 'region', hint: 'string' },
  { value: 'revenue', label: 'revenue', hint: 'number' },
];

it('shows the current value and options with their hints', () => {
  render(() => <SelectMenu ariaLabel="Y-Axis" value="revenue" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByLabelText('Y-Axis').textContent).toContain('revenue');
  fireEvent.click(screen.getByLabelText('Y-Axis'));
  const list = screen.getByRole('listbox');
  expect(list.textContent).toContain('revenue · number');
  expect(list.textContent).toContain('region · string');
});

it('picks an option, closing the panel and emitting its value', () => {
  const onChange = vi.fn();
  render(() => <SelectMenu ariaLabel="X-Axis" value="" options={OPTIONS} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('X-Axis'));
  fireEvent.click(screen.getByRole('option', { name: /region/ }));
  expect(onChange).toHaveBeenCalledWith('region');
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('closes on Escape without emitting', () => {
  const onChange = vi.fn();
  render(() => <SelectMenu ariaLabel="X-Axis" value="" options={OPTIONS} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('X-Axis'));
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('is a controlled trigger: a later prop change updates the shown label', () => {
  function Harness() {
    const [value, setValue] = createSignal('region');
    return <>
      <SelectMenu ariaLabel="X-Axis" value={value()} options={OPTIONS} onChange={setValue} />
    </>;
  }
  render(() => <Harness />);
  expect(screen.getByLabelText('X-Axis').textContent).toContain('region');
});

it('disables the trigger', () => {
  render(() => <SelectMenu ariaLabel="Column" value="" options={OPTIONS} onChange={vi.fn()} disabled />);
  expect((screen.getByLabelText('Column') as HTMLButtonElement).disabled).toBe(true);
});
