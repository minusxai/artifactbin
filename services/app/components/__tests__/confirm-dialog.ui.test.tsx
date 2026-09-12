import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ConfirmDialog, { useConfirmation } from '../ConfirmDialog';

it('names the consequence, focuses cancel, traps focus and cancels with Escape', () => {
  const cancel = vi.fn();
  const confirm = vi.fn();
  render(<ConfirmDialog title="Delete report?" description="Moves report to trash." action="Move to trash" onConfirm={confirm} onCancel={cancel} />);
  expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Moves report to trash.');
  const safe = screen.getByRole('button', { name: 'Cancel' });
  expect(safe).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
  expect(screen.getByRole('button', { name: 'Move to trash' })).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(cancel).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});

it('blocks confirmation and dismissal while an action is running', () => {
  const cancel = vi.fn();
  const confirm = vi.fn();
  render(<ConfirmDialog title="Delete report?" description="Moves report to trash." action="Move to trash" busy onConfirm={confirm} onCancel={cancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(confirm).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

function ActionHarness({ perform }: { perform: () => Promise<void> }) {
  const { confirmAction, confirmation } = useConfirmation();
  return <><button onClick={() => void confirmAction({ title: 'Delete report?', description: 'Moves report to trash.', action: 'Move to trash' }, perform)}>Delete</button>{confirmation}</>;
}

it('runs once on repeated confirmation and keeps a failed action available for retry', async () => {
  let fail!: (cause: Error) => void;
  const perform = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; })).mockResolvedValue(undefined);
  render(<ActionHarness perform={perform} />);
  const trigger = screen.getByRole('button', { name: 'Delete' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(perform).not.toHaveBeenCalled();
  const confirm = screen.getByRole('button', { name: 'Move to trash' });
  act(() => { confirm.click(); confirm.click(); });
  expect(perform).toHaveBeenCalledOnce();
  await act(async () => fail(new Error('Please retry')));
  expect(screen.getByRole('alert')).toHaveTextContent('Please retry');
  fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(perform).toHaveBeenCalledTimes(2);
  expect(trigger).toHaveFocus();
});

it('cancels a pending action when its owner unmounts', () => {
  const perform = vi.fn();
  const view = render(<ActionHarness perform={perform} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  view.unmount();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(perform).not.toHaveBeenCalled();
});
