import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import RemoteMentionPicker from "../RemoteMentionPicker";
import MarkdownLite from '../MarkdownLite';
import MarkdownField from '../MarkdownField';
import { useState } from 'react';
afterEach(() => vi.unstubAllGlobals());
it("lets the user select an online session with a stable mention ID", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          {
            id: "123",
            name: "Backend",
            harness: "claude",
            machine: "laptop",
            online: true,
          },
          { id: "456", name: "Old", harness: "codex", online: false },
        ],
      }),
    }),
  );
  const select = vi.fn();
  render(<RemoteMentionPicker query="back" onSelect={select} />);
  await waitFor(() =>
    expect(screen.getByLabelText("Mention Backend (claude)")).toBeTruthy(),
  );
  fireEvent.click(screen.getByLabelText("Mention Backend (claude)"));
  expect(select).toHaveBeenCalledWith("[@Backend](/chat?session=123) ");
  expect(screen.queryByLabelText("Mention Old (codex)")).toBeNull();
});

it('renders a session mention as a badge without displaying its URL', () => {
  const href = '/chat?session=7d545566-1a47-4aaf-be61-cffcb7b8e8f2';
  render(<MarkdownLite text={`Please ask [@Claude](${href})`} />);
  const badge = screen.getByRole('link', { name: '@Claude' });
  expect(badge.getAttribute('href')).toBe(href);
  expect(badge.hasAttribute('data-agent-mention')).toBe(true);
  expect(screen.queryByText(href)).toBeNull();
});

it('selects with the keyboard without submitting and Escape dismisses only the picker', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [
    { id: '7d545566-1a47-4aaf-be61-cffcb7b8e8f2', name: 'Claude', harness: 'claude', online: true, machine: 'laptop' },
  ] }) }));
  const submit = vi.fn();
  const escape = vi.fn();
  function Composer() {
    const [value, change] = useState('');
    const [previewing, preview] = useState(false);
    return <div onKeyDown={escape}><MarkdownField label="Draft" previewLabel="Draft preview" previewToggleLabel="Toggle preview"
      value={value} onChange={change} previewing={previewing} onPreviewingChange={preview} onSubmit={() => submit(value)} /></div>;
  }
  render(<Composer />);
  const field = screen.getByLabelText('Draft');
  fireEvent.change(field, { target: { value: '@cl', selectionStart: 3 } });
  await screen.findByLabelText('Mention Claude (claude)');
  fireEvent.keyDown(field, { key: 'Enter' });
  expect((field as HTMLTextAreaElement).value).toBe('@Claude ');
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
  expect(submit).toHaveBeenCalledWith('[@Claude](/chat?session=7d545566-1a47-4aaf-be61-cffcb7b8e8f2) ');
  fireEvent.change(field, { target: { value: '@', selectionStart: 1 } });
  await screen.findByLabelText('Mention Claude (claude)');
  escape.mockClear();
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByLabelText('Agent sessions')).toBeNull();
  expect(escape).not.toHaveBeenCalled();
});
