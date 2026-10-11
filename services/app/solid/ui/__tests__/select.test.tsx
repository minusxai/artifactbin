/* @jsxImportSource solid-js */
/**
 * The house select: a trigger button over a portalled listbox (not a native <select>), ported from
 * SelectMenu with its cases intact, plus the two densities and Field wiring.
 */
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { Select } from '../Select';
import { Field, Input } from '../Field';
import { Dialog } from '../Dialog';
import { LAYER } from '../layers';

const OPTIONS = [
  { value: '', label: '— none —' },
  { value: 'region', label: 'region', hint: 'string' },
  { value: 'revenue', label: 'revenue', hint: 'number' },
];

it('shows the current value and options with their hints', () => {
  render(() => <Select ariaLabel="Y-Axis" value="revenue" options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Y-Axis' }).textContent).toContain('revenue');
  fireEvent.click(screen.getByRole('button', { name: 'Y-Axis' }));
  const list = screen.getByRole('listbox', { name: 'Y-Axis options' });
  expect(list.textContent).toContain('revenue · number');
  expect(list.textContent).toContain('region · string');
  expect(screen.getByRole('option', { name: /revenue/ })).toHaveAttribute('aria-selected', 'true');
});

it('picks an option, closing the panel and emitting its value', () => {
  const onChange = vi.fn();
  render(() => <Select ariaLabel="X-Axis" value="" options={OPTIONS} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('X-Axis'));
  fireEvent.click(screen.getByRole('option', { name: /region/ }));
  expect(onChange).toHaveBeenCalledWith('region');
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('opens from the keyboard and picks with arrows and Enter', () => {
  const onChange = vi.fn();
  render(() => <Select ariaLabel="X-Axis" value="region" options={OPTIONS} onChange={onChange} />);
  const trigger = screen.getByRole('button', { name: 'X-Axis' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('revenue');
});

it('closes on Escape without emitting', () => {
  const onChange = vi.fn();
  render(() => <Select ariaLabel="X-Axis" value="" options={OPTIONS} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('X-Axis'));
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('is a controlled trigger: a later prop change updates the shown label', () => {
  const [value, setValue] = createSignal('region');
  render(() => <Select ariaLabel="X-Axis" value={value()} options={OPTIONS} onChange={vi.fn()} />);
  expect(screen.getByLabelText('X-Axis').textContent).toContain('region');
  setValue('revenue');
  expect(screen.getByLabelText('X-Axis').textContent).toContain('revenue');
});

it('disables the trigger', () => {
  render(() => <Select ariaLabel="Column" value="" options={OPTIONS} onChange={vi.fn()} disabled />);
  expect(screen.getByRole('button', { name: 'Column' })).toBeDisabled();
});

it('draws the trigger at the same height and radius as an Input of the same size', () => {
  render(() => <>
    <Select ariaLabel="Form select" value="" options={OPTIONS} onChange={vi.fn()} />
    <Input aria-label="Form input" />
    <Select ariaLabel="Chrome select" size="sm" value="" options={OPTIONS} onChange={vi.fn()} />
    <Input aria-label="Chrome input" size="sm" />
  </>);
  const classes = (name: string) => screen.getByLabelText(name).className.split(/\s+/);
  for (const token of ['h-control', 'rounded-control', 'font-sans', 'text-sm', 'border-edge-bright']) {
    expect(classes('Form select')).toContain(token);
    expect(classes('Form input')).toContain(token);
  }
  for (const token of ['h-control-sm', 'rounded-control', 'font-mono', 'text-xs', 'border-edge-bright']) {
    expect(classes('Chrome select')).toContain(token);
    expect(classes('Chrome input')).toContain(token);
  }
  expect(classes('Form select')).not.toContain('h-control-sm');
});

it('takes its name from a Field label', () => {
  render(() => <Field label="Company group" hint="Everyone starts here"><Select value="" options={OPTIONS} onChange={vi.fn()} /></Field>);
  const trigger = screen.getByRole('button', { name: 'Company group' });
  expect(trigger).toHaveAccessibleDescription('Everyone starts here');
  fireEvent.click(trigger);
  expect(screen.getByRole('listbox', { name: 'Company group options' })).toBeInTheDocument();
});

it('opens above a dialog it sits in', () => {
  render(() => <Dialog title="Pick" onClose={vi.fn()}><Select ariaLabel="Inside" value="" options={OPTIONS} onChange={vi.fn()} /></Dialog>);
  fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
  const layer = (el: Element | null): number => {
    for (let node = el as HTMLElement | null; node; node = node.parentElement) if (node.style?.zIndex) return Number(node.style.zIndex);
    return 0;
  };
  expect(LAYER.dialog).toBeLessThan(LAYER.popover);
  expect(LAYER.popover).toBeLessThan(LAYER.tooltip);
  expect(layer(screen.getByRole('listbox'))).toBe(LAYER.popover);
  expect(layer(screen.getByRole('dialog'))).toBe(LAYER.dialog);
  // Escape closes the listbox, not the dialog.
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Pick' })).toBeInTheDocument();
});

it('takes an id so a separate <label for> names it, and works inside a Field', () => {
  render(() => <>
    <label for="link-role">Link role</label>
    <Select id="link-role" value="region" options={OPTIONS} onChange={vi.fn()} />
  </>);
  expect(screen.getByRole('button', { name: 'Link role' })).toHaveAttribute('id', 'link-role');
});
