/* @jsxImportSource solid-js */
/**
 * Portalled surfaces follow the appearance of where they were opened (an editor's `data-app-appearance`
 * wrapper, not only the document root), and the non-modal FloatingPanel and the side Drawer.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { Select } from '../Select';
import { Menu } from '../Menu';
import { Tooltip } from '../Tooltip';
import { Dialog } from '../Dialog';
import { FloatingPanel } from '../FloatingPanel';
import { Drawer } from '../Drawer';
import { LAYER } from '../layers';

afterEach(() => { document.documentElement.removeAttribute('data-theme'); });

const appearance = (el: Element | null): string | null => el?.closest('[data-app-appearance]')?.getAttribute('data-app-appearance') ?? null;
const layer = (el: Element | null): number => {
  for (let node = el as HTMLElement | null; node; node = node.parentElement) if (node.style?.zIndex) return Number(node.style.zIndex);
  return 0;
};

it('opens a Select listbox, a Menu and a Tooltip in the dark appearance of an editor wrapper', async () => {
  render(() => <div data-app-appearance="dark">
    <Select ariaLabel="Role" value="a" options={[{ value: 'a', label: 'A' }]} onChange={vi.fn()} />
    <Menu label="Actions" items={[{ label: 'Rename', text: 'rename', onSelect: vi.fn() }]} trigger={(attrs) => <button {...attrs}>Actions</button>} />
    <Tooltip content="Tip text"><button>Hover me</button></Tooltip>
  </div>);
  fireEvent.click(screen.getByRole('button', { name: 'Role' }));
  const list = screen.getByRole('listbox');
  expect(list.closest('[data-app-appearance="dark"] [data-app-appearance]') ?? list).toBeTruthy();
  expect(appearance(list)).toBe('dark');
  expect(list.closest('[data-mx-theme-host]')).toHaveAttribute('data-app-appearance', 'dark');
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
  expect(screen.getByRole('menu').closest('[data-mx-theme-host]')).toHaveAttribute('data-app-appearance', 'dark');
  fireEvent.focus(screen.getByRole('button', { name: 'Hover me' }));
  await waitFor(() => expect(screen.getByRole('tooltip').closest('[data-mx-theme-host]')).toHaveAttribute('data-app-appearance', 'dark'));
});

it('keeps the light appearance of a light editor inside a dark document', () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  render(() => <div data-app-appearance="light"><Select ariaLabel="Role" value="a" options={[{ value: 'a', label: 'A' }]} onChange={vi.fn()} /></div>);
  fireEvent.click(screen.getByRole('button', { name: 'Role' }));
  expect(screen.getByRole('listbox').closest('[data-mx-theme-host]')).toHaveAttribute('data-app-appearance', 'light');
});

it('follows a dark document root when nothing closer sets an appearance', () => {
  document.documentElement.setAttribute('data-theme', 'dark');
  render(() => <Select ariaLabel="Role" value="a" options={[{ value: 'a', label: 'A' }]} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Role' }));
  expect(screen.getByRole('listbox').closest('[data-mx-theme-host]')).toHaveAttribute('data-app-appearance', 'dark');
});

it('opens a Dialog in the appearance of the control that opened it', () => {
  const [open, setOpen] = createSignal(false);
  render(() => <div data-app-appearance="dark"><button onClick={() => setOpen(true)}>Open settings</button>
    <Show when={open()}><Dialog title="Settings" onClose={() => setOpen(false)}><button>inside</button></Dialog></Show></div>);
  const opener = screen.getByRole('button', { name: 'Open settings' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Settings' });
  expect(dialog.parentElement).toHaveAttribute('data-app-appearance', 'dark');
});

it('floats a non-modal panel where the caller places it, at the popover layer, closing on Escape', () => {
  const onClose = vi.fn();
  render(() => <div data-app-appearance="dark"><FloatingPanel label="New comment" position={{ left: 40, top: 120 }} onClose={onClose}><textarea aria-label="Comment" /></FloatingPanel></div>);
  const panel = screen.getByRole('dialog', { name: 'New comment' });
  expect(panel).not.toHaveAttribute('aria-modal');
  expect(layer(panel)).toBe(LAYER.popover);
  expect(panel.style.left).toBe('40px');
  expect(panel.style.top).toBe('120px');
  expect(appearance(panel)).toBe('dark');
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Comment' }), { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('opens a Drawer over a scrim that closes it, at the dialog layer, returning focus', () => {
  const [open, setOpen] = createSignal(false);
  render(() => <><button onClick={() => setOpen(true)}>Open menu</button>
    <Show when={open()}><Drawer label="Menu" role="navigation" side="right" top={44} scrimLabel="Close panel" onClose={() => setOpen(false)}><a href="/">Artifacts</a></Drawer></Show></>);
  const opener = screen.getByRole('button', { name: 'Open menu' });
  opener.focus();
  fireEvent.click(opener);
  const nav = screen.getByRole('navigation', { name: 'Menu' });
  expect(layer(nav)).toBe(LAYER.dialog);
  expect(nav.style.top).toBe('44px');
  const scrim = screen.getByRole('button', { name: 'Close panel' });
  expect(scrim.style.top).toBe('44px');
  fireEvent.click(scrim);
  expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();
});
