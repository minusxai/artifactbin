/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { fireEvent, render } from '../../__tests__/helpers';
import { CommentMentionPicker } from '../CommentMentionPicker';
import { CommentMarkdownField } from '../CommentMarkdown';
import { createSignal } from 'solid-js';

const backend = (sessions: unknown[] = []) => ({
  unavailable: vi.fn(() => null),
  remoteSessions: vi.fn(async () => ({ sessions })),
  members: vi.fn(async () => ({ people: [] })),
  deleteRemoteSession: vi.fn(async () => {}),
}) as unknown as ArtifactBackend;

it('selects an online agent with a stable session mention and hides offline agents', async () => {
  const choose = vi.fn();
  const service = backend([{ id: 'a'.repeat(64), name: 'Backend', harness: 'claude', machine: 'laptop', online: true },
    { id: 'b'.repeat(64), name: 'Old', harness: 'codex', online: false }]);
  render(() => <CommentMentionPicker backend={service} query="back" onSelect={choose} />);
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Mention Backend (claude)' })));
  expect(choose).toHaveBeenCalledWith(`[@Backend](/chat?session=${'a'.repeat(64)}) `);
  expect(screen.queryByRole('button', { name: 'Mention Old (codex)' })).toBeNull();
});

it('copies setup guidance without selecting a mention or submitting', async () => {
  const copy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const choose = vi.fn();
  render(() => <CommentMentionPicker backend={backend()} query="" onSelect={choose} />);
  fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Copy connection request' })));
  expect(copy).toHaveBeenCalledWith('Connect to afbin remote so I can @mention you in artifact comments.');
  expect(choose).not.toHaveBeenCalled();
});

it('selects a mention by keyboard without submitting and keeps its ID in the draft', async () => {
  const session = { id: 'c'.repeat(64), name: 'Claude', harness: 'claude', machine: 'laptop', online: true };
  const service = backend([session]);
  let raw!: () => string;
  const submit = vi.fn();
  const view = render(() => { const [value, setValue] = createSignal(''); raw = value; return <CommentMarkdownField label="Draft" value={value()} onChange={setValue} onSubmit={submit} backend={service} />; });
  const field = view.getByRole('textbox', { name: 'Draft' });
  fireEvent.input(field, { target: { value: '@cl', selectionStart: 3 } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mention Claude (claude)' })).toBeTruthy());
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(field).toHaveValue('@Claude ');
  expect(raw()).toBe(`[@Claude](/chat?session=${session.id}) `);
  expect(submit).not.toHaveBeenCalled();
});
