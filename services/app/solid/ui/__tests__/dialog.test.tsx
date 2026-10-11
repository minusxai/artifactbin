/* @jsxImportSource solid-js */
/** The modal: name and description, focus trap, Escape, backdrop and busy — and ConfirmDialog on top of it. */
import { expect, it, vi } from 'vitest';
import { createSignal, Show } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import { Dialog } from '../Dialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { Button } from '../Button';

it('names and describes the dialog, focuses inside it and traps Tab', () => {
  render(() => <>
    <button>opener</button>
    <Dialog title="Transfer ownership" description="Choose the new owner." onClose={vi.fn()} footer={<Button>Confirm transfer</Button>}>
      <input aria-label="Owner" />
    </Dialog>
  </>);
  const dialog = screen.getByRole('dialog', { name: 'Transfer ownership' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog).toHaveAccessibleDescription('Choose the new owner.');
  expect(dialog.className).toContain('rounded-dialog');
  expect(screen.getByRole('heading', { level: 2, name: 'Transfer ownership' })).toBeInTheDocument();
  const first = screen.getByRole('textbox', { name: 'Owner' });
  const last = screen.getByRole('button', { name: 'Confirm transfer' });
  expect(document.activeElement).toBe(first);
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(last);
});

it('honours an initial focus selector', () => {
  render(() => <Dialog title="Pick" initialFocus="[data-start]" onClose={vi.fn()}><button>one</button><button data-start>two</button></Dialog>);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'two' }));
});

it('closes on Escape and on a backdrop press, restoring focus to the opener', () => {
  const [open, setOpen] = createSignal(false);
  const onClose = vi.fn(() => setOpen(false));
  render(() => <><button>opener</button><Show when={open()}><Dialog title="Sizes" size="lg" onClose={onClose}><button>inside</button></Dialog></Show></>);
  screen.getByText('opener').focus();
  setOpen(true);
  expect(screen.getByRole('dialog').className).toContain('max-w-2xl');
  fireEvent.mouseDown(screen.getByRole('button', { name: 'inside' }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(screen.getByText('opener'));
  setOpen(true);
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  expect(onClose).toHaveBeenCalledTimes(2);
});

it('ignores Escape and the backdrop while busy', () => {
  const onClose = vi.fn();
  render(() => <Dialog title="Saving" busy onClose={onClose}><button>inside</button></Dialog>);
  expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  expect(onClose).not.toHaveBeenCalled();
});

it('keeps ConfirmDialog\'s contract on the shared dialog', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const [busy, setBusy] = createSignal(false);
  render(() => <ConfirmDialog title="Delete Doc?" description="It goes to the trash." action="Delete" confirmLabel="Confirm delete" danger busy={busy()} error="Could not delete this artifact." onConfirm={onConfirm} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog', { name: 'Delete Doc?' });
  expect(dialog).toHaveAccessibleDescription('It goes to the trash.');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not delete this artifact.');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
  setBusy(true);
  expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveTextContent('Delete…');
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it('takes an accessible name apart from its visible title, an xl size, top alignment and a header close button', () => {
  const onClose = vi.fn();
  render(() => <Dialog title="Quarterly review" label="Sharing" size="xl" align="top" closeLabel="Close sharing" onClose={onClose}><button>inside</button></Dialog>);
  const dialog = screen.getByRole('dialog', { name: 'Sharing' });
  expect(dialog.className).toContain('max-w-4xl');
  expect(dialog.parentElement!.className).toContain('items-start');
  expect(screen.getByRole('heading', { level: 2, name: 'Quarterly review' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close sharing' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('scrolls its body between a fixed header and footer, edge to edge when flush', () => {
  render(() => <Dialog title="Social preview" body="flush" onClose={vi.fn()} footer={<Button>Save</Button>}><div>stage</div></Dialog>);
  const body = screen.getByText('stage').parentElement!;
  expect(body).toHaveAttribute('data-dialog-body');
  expect(body.className).toContain('overflow-y-auto');
  expect(body.className).not.toContain('px-6');
  expect(screen.getByRole('button', { name: 'Save' }).parentElement!.className).toContain('shrink-0');
});

it('draws an alertdialog that neither Escape nor the backdrop dismisses', () => {
  const onClose = vi.fn();
  render(() => <Dialog role="alertdialog" dismissible={false} title="Your text needs recovery" onClose={onClose}><textarea aria-label="Uncommitted text" /></Dialog>);
  const dialog = screen.getByRole('alertdialog', { name: 'Your text needs recovery' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
});
