/**
 * Code view where the rich editor and the formatter cannot be had — an offline
 * file with no connection (components/SourceEditorTools, lib/offline/extras):
 * the plain editor, saying why in place, and a disabled "View formatted".
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SourceEditorPane from '@/components/SourceEditorPane';
import { SourceEditorToolsProvider, type SourceEditorTools } from '@/components/SourceEditorTools';
import { FORMATTING_OFFLINE, RICH_EDITOR_OFFLINE } from '@/lib/offline/extras';

afterEach(cleanup);

const offline = (over: Partial<SourceEditorTools> = {}): SourceEditorTools => ({
  editor: vi.fn(() => Promise.reject(new Error(RICH_EDITOR_OFFLINE))),
  formatter: vi.fn(() => Promise.reject(new Error(FORMATTING_OFFLINE))),
  editorFailure: RICH_EDITOR_OFFLINE,
  formatterUnavailable: FORMATTING_OFFLINE,
  ...over,
});

describe('code view without its extras', () => {
  it('keeps the plain editor, says why in place, and still edits', async () => {
    const onChange = vi.fn();
    const tools = offline();
    render(<SourceEditorToolsProvider value={tools}><SourceEditorPane value="<p>Hi</p>" revision={0} onChange={onChange} /></SourceEditorToolsProvider>);
    // The failed load swaps the loading fallback for the plain editor that says why.
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Markup source' })).toHaveAccessibleDescription(RICH_EDITOR_OFFLINE));
    const source = screen.getByRole('textbox', { name: 'Markup source' });
    expect(screen.getByRole('status')).toHaveTextContent(RICH_EDITOR_OFFLINE);
    expect(screen.queryByText(/Rich editor unavailable/)).toBeNull();
    fireEvent.change(source, { target: { value: '<p>Hi there</p>' } });
    expect(onChange).toHaveBeenCalledWith('<p>Hi there</p>');
    // Retry asks again.
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading rich editor' }));
    await waitFor(() => expect(tools.editor).toHaveBeenCalledTimes(2));
  });

  it('disables "View formatted" with the reason', () => {
    render(<SourceEditorToolsProvider value={offline()}><SourceEditorPane value="<p>Hi</p>" revision={0} onChange={() => {}} /></SourceEditorToolsProvider>);
    const view = screen.getByRole('button', { name: 'View formatted' });
    expect(view).toBeDisabled();
    expect(view).toHaveAccessibleDescription(FORMATTING_OFFLINE);
  });

  it('offers "View formatted" while the extras may still load', async () => {
    const formatJsxPreview = vi.fn(async (s: string) => `formatted:${s}`);
    const tools = offline({ formatterUnavailable: null, formatter: vi.fn(async () => ({ formatJsxPreview })) });
    render(<SourceEditorToolsProvider value={tools}><SourceEditorPane value="<p>Hi</p>" revision={0} onChange={() => {}} /></SourceEditorToolsProvider>);
    const view = screen.getByRole('button', { name: 'View formatted' });
    expect(view).toBeEnabled();
    fireEvent.click(view);
    await waitFor(() => expect(formatJsxPreview).toHaveBeenCalledWith('<p>Hi</p>'));
  });
});
