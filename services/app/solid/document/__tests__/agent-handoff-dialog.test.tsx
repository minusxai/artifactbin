/* @jsxImportSource solid-js */
/** A doc's "hand to an agent" (solid/document/AgentHandoffDialog): the agent starter's paste for this page, in a dialog. */
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import '@testing-library/jest-dom/vitest';
import { existingPaste } from '@/lib/agent-copy/agent-copy';
import { AgentHandoffDialog } from '../AgentHandoffDialog';

it('shows the paste for this doc, copies it, and closes, without the starter page\'s waiting line', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const close = vi.fn();
  try {
    render(() => <AgentHandoffDialog id="doc123" template="doc" onClose={close} />);
    const view = screen;
    const dialog = view.getByRole('dialog', { name: 'Hand to an agent' });
    const paste = existingPaste(window.location.origin, 'doc123', 'doc');
    expect((view.getByRole('textbox', { name: 'Agent instructions' }) as HTMLTextAreaElement).value).toBe(paste);
    expect(paste).toContain('/a/doc123');
    expect(dialog).toHaveTextContent('tell it what to do with this document');
    expect(view.queryByText('Waiting for your agent…')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Copy agent instructions' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(paste));
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
