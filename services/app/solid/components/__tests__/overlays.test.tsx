/* @jsxImportSource solid-js */
/** The shared overlay contracts: the modal shell (kit/dialog-shell) and the one-open popup rule. */
import { expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { DialogShell } from '../DialogShell';
import { Popover } from '../Popover';

function Dialog(props: { name: string; onClose: () => void; lock?: boolean }) {
  return <DialogShell onClose={props.onClose} lockScroll={props.lock} initialFocus="[data-first]">
    <div role="dialog" aria-label={props.name}><button data-first>{`${props.name} first`}</button><button>{`${props.name} last`}</button></div>
  </DialogShell>;
}

it('closes only the top dialog on Escape, traps Tab, restores focus and the scroll lock', () => {
  const [outer, setOuter] = createSignal(false);
  const [inner, setInner] = createSignal(false);
  const closeOuter = vi.fn(() => setOuter(false));
  const closeInner = vi.fn(() => setInner(false));
  document.body.style.overflow = 'scroll';
  render(() => <>
    <button>opener</button>
    <Show when={outer()}><Dialog name="outer" onClose={closeOuter} lock /></Show>
    <Show when={inner()}><Dialog name="inner" onClose={closeInner} lock /></Show>
  </>);
  screen.getByText('opener').focus();
  setOuter(true);
  expect(document.activeElement).toBe(screen.getByText('outer first'));
  expect(document.body.style.overflow).toBe('hidden');
  setInner(true);
  expect(document.activeElement).toBe(screen.getByText('inner first'));

  // Tab from the last stop wraps to the first, Shift+Tab from the first to the last — in the top dialog.
  screen.getByText('inner last').focus();
  fireEvent.keyDown(screen.getByText('inner last'), { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByText('inner first'));
  fireEvent.keyDown(screen.getByText('inner first'), { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(screen.getByText('inner last'));

  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(closeInner).toHaveBeenCalledTimes(1);
  expect(closeOuter).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByText('outer first'));
  expect(document.body.style.overflow).toBe('hidden');

  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(closeOuter).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByText('opener'));
  expect(document.body.style.overflow).toBe('scroll');
});

it('leaves the dialog open when an inner popup already handled Escape', () => {
  const onClose = vi.fn();
  render(() => <Dialog name="solo" onClose={onClose} />);
  const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  handled.preventDefault();
  screen.getByText('solo first').dispatchEvent(handled);
  expect(onClose).not.toHaveBeenCalled();
});

it('keeps one popover open at a time and closes on an outside press or Escape', () => {
  const [a, setA] = createSignal(false);
  const [b, setB] = createSignal(false);
  render(() => <>
    <Popover open={a()} onOpenChange={setA} label="A panel" trigger={(attrs) => <button ref={attrs.ref} onClick={() => setA(!a())}>A</button>}><span>in A</span></Popover>
    <Popover open={b()} onOpenChange={setB} label="B panel" trigger={(attrs) => <button ref={attrs.ref} onClick={() => setB(!b())}>B</button>}><span>in B</span></Popover>
    <p>outside</p>
  </>);
  fireEvent.click(screen.getByText('A'));
  expect(a()).toBe(true);
  fireEvent.pointerDown(screen.getByText('in A'));
  expect(a()).toBe(true);
  fireEvent.click(screen.getByText('B'));
  expect(b()).toBe(true);
  expect(a()).toBe(false);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(b()).toBe(false);
  fireEvent.click(screen.getByText('A'));
  fireEvent.pointerDown(screen.getByText('outside'));
  expect(a()).toBe(false);
});
