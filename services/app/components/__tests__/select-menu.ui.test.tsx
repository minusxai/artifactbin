/**
 * The house dropdown. A native <select> cannot wear the terminal-graphite
 * chrome (option lists are OS-drawn), so this is a listbox: trigger button,
 * absolute panel, dismiss-on-outside — the ThemePicker pattern made reusable.
 * The cases below are what a native select gave us for free and a custom one
 * silently loses: keyboard flow, escape, disabled, an unknown value.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectMenu } from '../SelectMenu';

const OPTIONS = [
  { value: '', label: '— none —' },
  { value: 'region', label: 'region', hint: 'string' },
  { value: 'revenue', label: 'revenue', hint: 'number' },
];

let onChange: ReturnType<typeof vi.fn<(v: string) => void>>;
beforeEach(() => { onChange = vi.fn<(v: string) => void>(); });

const menu = (props: Partial<React.ComponentProps<typeof SelectMenu>> = {}) =>
  render(<SelectMenu ariaLabel="X-Axis" value="region" options={OPTIONS} onChange={onChange} {...props} />);

const trigger = () => screen.getByLabelText('X-Axis') as HTMLButtonElement;

describe('SelectMenu', () => {
  it('names the current value on the trigger, closed by default', () => {
    menu();
    expect(trigger().textContent).toContain('region');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens on click and lists every option with its hint', () => {
    menu();
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: /revenue/ }).textContent).toContain('number');
  });

  it('picking an option reports the VALUE and closes', () => {
    menu();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: /revenue/ }));
    expect(onChange).toHaveBeenCalledWith('revenue');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks the current option selected', () => {
    menu();
    fireEvent.click(trigger());
    expect(screen.getByRole('option', { name: /region/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /revenue/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('Escape closes without a change', () => {
    menu();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arrows walk the list and Enter picks', () => {
    menu();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' }); // region → revenue
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('revenue');
  });

  it('does not open when disabled', () => {
    menu({ disabled: true });
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the placeholder when the value matches no option', () => {
    menu({ value: 'gonezz', placeholder: 'gonezz (missing)' });
    expect(trigger().textContent).toContain('gonezz (missing)');
  });

  /**
   * A dropdown that opens INSIDE its caller is at the mercy of that caller's
   * overflow. The share dialog is a centered panel with `overflow-hidden`
   * (it has to be — it rounds its own corners and scrolls its own body), so
   * the role listbox on the last person in the list was cut in half and
   * `can edit` could not be picked at all.
   *
   * z-index cannot answer this: stacking does not escape a clip. Only leaving
   * the subtree does, which is the same rule Tooltip already lives by.
   *
   * jsdom has no layout, so the CLIPPING itself is not observable here — but
   * the property that prevents it is: the panel must not be a descendant of
   * the thing that would clip it.
   */
  it('escapes a clipping ancestor — the panel is portalled out of it', () => {
    const { container } = render(
      <div className="overflow-hidden">
        <SelectMenu ariaLabel="X-Axis" value="region" options={OPTIONS} onChange={onChange} />
      </div>,
    );
    const clipper = container.firstElementChild!;
    fireEvent.click(trigger());
    expect(clipper.contains(screen.getByRole('listbox'))).toBe(false);
  });
});
