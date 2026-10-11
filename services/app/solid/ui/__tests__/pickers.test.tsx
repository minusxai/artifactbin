/* @jsxImportSource solid-js */
/** The value pickers: ColorField, the swatch radio group, Slider and ToggleGroup. */
import { expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { ColorField, SWATCHES, SwatchPicker } from '../ColorField';
import { Slider } from '../Slider';
import { ToggleGroup } from '../ToggleGroup';
import { Field } from '../Field';

it('edits a color through its swatch picker or its hex text, named by its Field', () => {
  const [color, setColor] = createSignal('#112233');
  render(() => <Field label="Theme color" hint="App title bar"><ColorField value={color()} onChange={setColor} /></Field>);
  const hex = screen.getByRole('textbox', { name: 'Theme color' });
  expect(hex).toHaveValue('#112233');
  expect(hex).toHaveAccessibleDescription('App title bar');
  const native = screen.getByLabelText('Theme color picker') as HTMLInputElement;
  expect(native.type).toBe('color');
  fireEvent.input(native, { target: { value: '#445566' } });
  expect(color()).toBe('#445566');
  expect(hex).toHaveValue('#445566');
  fireEvent.input(hex, { target: { value: '#abc' } });
  expect(color()).toBe('#aabbcc');
  fireEvent.input(hex, { target: { value: 'not a color' } });
  expect(color()).toBe('#aabbcc');
  expect(hex).toHaveAttribute('aria-invalid', 'true');
  fireEvent.blur(hex);
  expect(hex).toHaveValue('#aabbcc');
  expect(hex).not.toHaveAttribute('aria-invalid');
});

it('names a ColorField by ariaLabel outside a Field and draws the chrome size', () => {
  render(() => <ColorField ariaLabel="Text color" size="sm" value="#000000" onChange={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Text color' }).className).toContain('h-control-sm');
  expect(screen.getByLabelText('Text color picker')).toBeInTheDocument();
});

it('picks a swatch as a radio group with a roving tab stop and arrow keys', () => {
  const [color, setColor] = createSignal(SWATCHES[0]!.value);
  render(() => <SwatchPicker label="Brush colors" options={SWATCHES.slice(0, 3)} value={color()} onChange={setColor} />);
  const group = screen.getByRole('radiogroup', { name: 'Brush colors' });
  const radios = screen.getAllByRole('radio');
  expect(group).toContainElement(radios[0]!);
  expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  expect(radios[0]).toHaveAttribute('tabindex', '0');
  expect(radios[1]).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' });
  expect(color()).toBe(SWATCHES[1]!.value);
  expect(document.activeElement).toBe(radios[1]);
  fireEvent.keyDown(radios[1]!, { key: 'ArrowLeft' });
  fireEvent.keyDown(radios[0]!, { key: 'ArrowLeft' });
  expect(color()).toBe(SWATCHES[2]!.value);
  fireEvent.click(screen.getByRole('radio', { name: SWATCHES[1]!.label }));
  expect(color()).toBe(SWATCHES[1]!.value);
});

it('slides a value with a named range input and shows its value text', () => {
  const [width, setWidth] = createSignal(4);
  render(() => <Slider label="Brush thickness" min={1} max={16} value={width()} onChange={setWidth} valueText={(v) => `${v} px`} />);
  const range = screen.getByRole('slider', { name: 'Brush thickness' });
  expect(range).toHaveAttribute('min', '1');
  expect(range).toHaveAttribute('max', '16');
  expect(range).toHaveAttribute('aria-valuetext', '4 px');
  fireEvent.input(range, { target: { value: '9' } });
  expect(width()).toBe(9);
  expect(screen.getByText('9 px')).toBeInTheDocument();
});

it('keeps one ToggleGroup option pressed, as buttons, with icons, tooltips and a caution tone', () => {
  const [visibility, setVisibility] = createSignal('public');
  render(() => <ToggleGroup label="Visibility" size="sm" fill value={visibility()} onChange={setVisibility} options={[
    { value: 'public', label: 'public', ariaLabel: 'Make public', icon: () => <svg data-icon="globe" />, tooltip: 'Anyone can find it' },
    { value: 'unlisted', label: 'unlisted', ariaLabel: 'Make unlisted' },
    { value: 'readwrite', label: 'read & write', ariaLabel: 'Make read & write', tone: 'caution' },
  ]} />);
  expect(screen.getByRole('group', { name: 'Visibility' })).toBeInTheDocument();
  const pub = screen.getByRole('button', { name: 'Make public' });
  expect(pub).toHaveAttribute('aria-pressed', 'true');
  expect(pub.querySelector('[data-icon="globe"]')).not.toBeNull();
  expect(pub.className).toContain('flex-1');
  fireEvent.click(screen.getByRole('button', { name: 'Make unlisted' }));
  expect(visibility()).toBe('unlisted');
  expect(pub).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Make read & write' }));
  expect(screen.getByRole('button', { name: 'Make read & write' }).className).toContain('bg-caution-soft');
});

it('ToggleGroup options are type="button": one inside a form never submits it', () => {
  const onSubmit = vi.fn((event: Event) => event.preventDefault());
  render(() => <form onSubmit={onSubmit}><ToggleGroup label="Mode" value="a" onChange={() => {}} options={[{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }]} /></form>);
  for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('type', 'button');
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it('ToggleGroup keeps its buttons when a caller rebuilds the options array on every read', () => {
  const [value, setValue] = createSignal('a');
  const [tick, setTick] = createSignal(0);
  // The options are a fresh array of fresh objects whenever `tick` or `value` changes, as a caller's inline `options={[...]}` over a signal is.
  render(() => <ToggleGroup label="Mode" value={value()} onChange={setValue} options={(tick(), [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }])} />);
  const before = screen.getAllByRole('button');
  const [a] = before;
  a!.focus();
  setTick(1);
  fireEvent.click(screen.getByRole('button', { name: 'b' }));
  setTick(2);
  const after = screen.getAllByRole('button');
  expect(after.length).toBe(before.length);
  after.forEach((button, index) => expect(button).toBe(before[index]));
  expect(screen.getByRole('button', { name: 'b' })).toHaveAttribute('aria-pressed', 'true');
  expect(a).toHaveAttribute('aria-pressed', 'false');
});
