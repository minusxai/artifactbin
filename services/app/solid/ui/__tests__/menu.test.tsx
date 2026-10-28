/* @jsxImportSource solid-js */
/** The action menu: menu/menuitem roles, keyboard, focus return and the row preset's invariants. */
import { expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { screen, within } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { Menu, RowMenu } from '../Menu';
import { Dialog } from '../Dialog';
import { TrustedUi } from '../../components/TrustedUi';

const items = (selected: (name: string) => void) => [
  { label: 'Rename Report', text: 'rename', onSelect: () => selected('rename') },
  { label: 'Archive Report', text: 'archive', disabled: true, onSelect: () => selected('archive') },
  { label: 'Move Report', text: 'move', onSelect: () => selected('move') },
  { label: 'Delete Report', text: 'delete', danger: true, onSelect: () => selected('delete') },
];

function open(selected = vi.fn()) {
  render(() => <Menu label="Report actions" items={items(selected)} trigger={(attrs) => <button {...attrs}>Actions</button>} />);
  const trigger = screen.getByRole('button', { name: 'Actions' });
  return { trigger, selected };
}

it('opens a menu of menuitems and focuses the first enabled one', () => {
  const { trigger } = open();
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: 'Report actions' })).toBeInTheDocument();
  expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(['Rename Report', 'Archive Report', 'Move Report', 'Delete Report']);
  expect(screen.getByRole('menuitem', { name: 'Archive Report' })).toBeDisabled();
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename Report' }));
});

it('moves with arrows, Home and End, skipping disabled items and wrapping', () => {
  const { trigger } = open();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const item = (name: string) => screen.getByRole('menuitem', { name });
  expect(document.activeElement).toBe(item('Rename Report'));
  fireEvent.keyDown(item('Rename Report'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('Move Report'));
  fireEvent.keyDown(item('Move Report'), { key: 'End' });
  expect(document.activeElement).toBe(item('Delete Report'));
  fireEvent.keyDown(item('Delete Report'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('Rename Report'));
  fireEvent.keyDown(item('Rename Report'), { key: 'ArrowUp' });
  expect(document.activeElement).toBe(item('Delete Report'));
  fireEvent.keyDown(item('Delete Report'), { key: 'Home' });
  expect(document.activeElement).toBe(item('Rename Report'));
});

it('closes on Escape and returns focus to the trigger', () => {
  const { trigger, selected } = open();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename Report' }), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(selected).not.toHaveBeenCalled();
});

it('selects with Enter or a click, closing first and returning focus to the trigger', () => {
  const { trigger, selected } = open();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move Report' }));
  expect(selected).toHaveBeenCalledWith('move');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('hands focus back to the trigger after a dialog opened from an item closes', () => {
  function Host() {
    const [dialog, setDialog] = createSignal(false);
    return <>
      <RowMenu name="Report" items={[{ label: 'Delete Report', text: 'delete', icon: () => <span>x</span>, onSelect: () => setDialog(true) }]} />
      <Show when={dialog()}><Dialog title="Delete Report?" onClose={() => setDialog(false)}><button>Confirm</button></Dialog></Show>
    </>;
  }
  render(() => <Host />);
  const trigger = screen.getByRole('button', { name: 'More actions for Report' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Report' }));
  expect(screen.getByRole('dialog', { name: 'Delete Report?' })).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('updates RowMenu items in place when the caller rebuilds them', () => {
  const [busy, setBusy] = createSignal(false);
  render(() => <RowMenu name="Doc" items={[{ label: 'Restore Doc', text: busy() ? 'restoring…' : 'restore', icon: () => <span>r</span>, disabled: busy(), onSelect: vi.fn() }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'More actions for Doc' }));
  const item = screen.getByRole('menuitem', { name: 'Restore Doc' });
  setBusy(true);
  expect(screen.getByRole('menuitem', { name: 'Restore Doc' })).toBe(item);
  expect(item).toHaveTextContent('restoring…');
  expect(item).toBeDisabled();
});

it('draws nothing when a RowMenu has no items', () => {
  render(() => <RowMenu name="Doc" items={[]} />);
  expect(screen.queryByRole('button', { name: 'More actions for Doc' })).toBeNull();
});

it('draws link items, labelled sections, separators and checked items', () => {
  const choose = vi.fn();
  render(() => <Menu label="Create menu" items={[
    { label: 'Folder', text: 'Folder', onSelect: choose },
    { label: 'Program', text: 'Program', href: '/programs/new' },
    { separator: true },
    { section: 'assets', items: [{ label: 'File', text: 'File', href: '/files/new' }, { label: 'Dataset', text: 'Dataset', href: '/datasets/new' }] },
    { label: 'Show archived', text: 'archived', checked: true, onSelect: choose },
  ]} trigger={(attrs) => <button {...attrs}>Create</button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  const program = screen.getByRole('menuitem', { name: 'Program' });
  expect(program.tagName).toBe('A');
  expect(program).toHaveAttribute('href', '/programs/new');
  expect(screen.getByRole('separator')).toBeInTheDocument();
  const assets = screen.getByRole('group', { name: 'assets' });
  expect(assets).toContainElement(screen.getByRole('menuitem', { name: 'Dataset' }));
  const archived = screen.getByRole('menuitemcheckbox', { name: 'Show archived' });
  expect(archived).toHaveAttribute('aria-checked', 'true');
  // Arrow keys walk links, grouped items and checkbox items alike.
  const item = (name: string) => screen.getByRole('menuitem', { name });
  fireEvent.keyDown(item('Folder'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('Program'));
  fireEvent.keyDown(item('Program'), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(item('File'));
  fireEvent.keyDown(item('File'), { key: 'End' });
  expect(document.activeElement).toBe(archived);
});

it('opens a submenu flyout with ArrowRight and closes it with ArrowLeft', () => {
  const pick = vi.fn();
  render(() => <Menu label="Create menu" items={[
    { label: 'Artifact', text: 'Artifact', items: [{ label: 'Doc', text: 'Doc', onSelect: () => pick('doc') }, { label: 'Deck', text: 'Deck', onSelect: () => pick('deck') }] },
    { label: 'Folder', text: 'Folder', onSelect: () => pick('folder') },
  ]} trigger={(attrs) => <button {...attrs}>Create</button>} />);
  const trigger = screen.getByRole('button', { name: 'Create' });
  fireEvent.click(trigger);
  const artifact = screen.getByRole('menuitem', { name: 'Artifact' });
  expect(artifact).toHaveAttribute('aria-haspopup', 'menu');
  expect(artifact).toHaveAttribute('aria-expanded', 'false');
  fireEvent.keyDown(artifact, { key: 'ArrowRight' });
  expect(artifact).toHaveAttribute('aria-expanded', 'true');
  const sub = screen.getByRole('menu', { name: 'Artifact' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Doc' }));
  // Arrows stay inside the submenu.
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Doc' }), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Deck' }));
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Deck' }), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Doc' }));
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Doc' }), { key: 'ArrowLeft' });
  expect(sub).not.toBeInTheDocument();
  expect(document.activeElement).toBe(artifact);
  fireEvent.click(artifact);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Deck' }));
  expect(pick).toHaveBeenCalledWith('deck');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('matches the trigger width when asked', () => {
  render(() => <Menu label="Wide" width="trigger" items={[{ label: 'One', text: 'one', onSelect: vi.fn() }]} trigger={(attrs) => <button {...attrs}>Wide</button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Wide' }));
  expect(screen.getByRole('menu', { name: 'Wide' }).getAttribute('style')).toContain('--radix-popper-anchor-width');
});

it('navigates a trusted shadow menu through arrows, Home, End and Escape', () => {
  render(() => <><TrustedUi><span /></TrustedUi><Menu label="Shadow actions" items={items(vi.fn())} trigger={attrs => <button {...attrs}>Shadow actions</button>} /></>);
  const trigger=screen.getByRole('button',{name:'Shadow actions'});
  const root=document.querySelector('[data-trusted-ui]')!.shadowRoot!;
  const query=within(root.querySelector<HTMLElement>('[data-trusted-ui-root]')!);
  const item=(name:string)=>query.getByRole('menuitem',{name});
  fireEvent.keyDown(trigger,{key:'ArrowDown'});
  expect(root.activeElement).toBe(item('Rename Report'));
  fireEvent.keyDown(item('Rename Report'),{key:'ArrowDown'});
  expect(root.activeElement).toBe(item('Move Report'));
  fireEvent.keyDown(item('Move Report'),{key:'End'});
  expect(root.activeElement).toBe(item('Delete Report'));
  fireEvent.keyDown(item('Delete Report'),{key:'ArrowDown'});
  expect(root.activeElement).toBe(item('Rename Report'));
  fireEvent.keyDown(item('Rename Report'),{key:'ArrowUp'});
  expect(root.activeElement).toBe(item('Delete Report'));
  fireEvent.keyDown(item('Delete Report'),{key:'Home'});
  expect(root.activeElement).toBe(item('Rename Report'));
  fireEvent.keyDown(item('Rename Report'),{key:'Escape'});
  expect(query.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
