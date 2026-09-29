/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import type { AnnotationWire } from '@/lib/annotations';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import type { StoryController } from '@/lib/story-runtime/contract';
import { fireEvent, render } from '../../__tests__/helpers';
import { AnnotationLayer } from '../AnnotationLayer';

const thread = { id: 'ann1', status: 'open', snippet: 'Selected passage', thread: [{ id: 'c1', body: 'First comment', author: { label: 'Ana' }, created_at: new Date().toISOString() }] } as AnnotationWire;
const backend = (overrides: Partial<ArtifactBackend> = {}) => ({
  listAnnotations: vi.fn(async () => [thread]), actOnAnnotation: vi.fn(async () => ({ ...thread, status: 'resolved' })),
  createAnnotation: vi.fn(async () => thread), deleteAnnotation: vi.fn(async () => {}), ...overrides,
}) as unknown as ArtifactBackend;
afterEach(() => vi.unstubAllGlobals());

it('loads open comments and resolves a thread through the backend', async () => {
  const service = backend(); const changed = vi.fn();
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}} onAnnotationsChange={changed} />);
  await waitFor(() => expect(view.getByText('First comment')).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: 'Resolve annotation' }));
  await waitFor(() => expect(service.actOnAnnotation).toHaveBeenCalledWith('ann1', { resolve: true }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith([]));
});

it('keeps a draft when the annotation write fails', async () => {
  const service = backend({ createAnnotation: vi.fn(async () => { throw new Error('stale: retake'); }) });
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}}
    initialSelection={{ kind: 'text', path: '0', nodeId: 'node1', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [], quote: 'Selected passage' }} />);
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'My draft' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('stale: retake'));
  expect(view.getByRole('textbox', { name: 'New comment' })).toHaveValue('My draft');
});

it('posts only pin locations to the document runtime and opens the rail on pin click', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; } } as unknown as StoryController;
  const located = { ...thread, orphaned: false, anchor: { path: '0', key: 'anchor-key' } } as AnnotationWire;
  const open = vi.fn();
  render(() => <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async () => [located]) })} railOpen={false} onRailOpenChange={open}
    runtimeRef={{ current: runtime }} sessionNonce="private" showViewComments />);
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', pins: [expect.objectContaining({ id: 'ann1', path: '0', key: 'anchor-key' })] })));
  const message = send.mock.calls.at(-1)![0] as { pins: unknown[] };
  expect(JSON.stringify(message)).not.toContain('First comment');
  receive?.({ type: 'mx:annotation-pin', nonce: 'private', id: 'ann1', rect: { x: 0, y: 0, width: 1, height: 1 } });
  expect(open).toHaveBeenCalledWith(true);
});

it('opens a one-shot Select pick from the rail and composes on the frame selection', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; } } as unknown as StoryController;
  const service = backend();
  const view = render(() => <AnnotationLayer id="abc" backend={service} railOpen onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" />);
  await waitFor(() => expect(view.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true'));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', pick: 'select' }));
  receive?.({ type: 'mx:selection', nonce: 'private', selection: { kind: 'text', path: '2.1', nodeId: 'node-2-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] } });
  expect(view.getByRole('dialog', { name: 'Annotation composer' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.input(view.getByRole('textbox', { name: 'New comment' }), { target: { value: 'picked note' } });
  fireEvent.click(view.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(service.createAnnotation).toHaveBeenCalledWith(expect.objectContaining({ path: '2.1', node_id: 'node-2-1', body: 'picked note' }), expect.any(String)));
});

it('places floating annotation markers at their reported document geometry', async () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const runtime = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; }, getViewportRect: () => ({ left: 50, top: 40, width: 800, height: 600 }) } as unknown as StoryController;
  const located = { ...thread, anchor: { path: '0', key: 'anchor-key' } } as AnnotationWire;
  const view = render(() => <AnnotationLayer id="abc" backend={backend({ listAnnotations: vi.fn(async () => [located]) })} railOpen={false} onRailOpenChange={() => {}}
    runtimeRef={{ current: runtime }} sessionNonce="private" showViewComments />);
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mx:annotations', pins: [expect.objectContaining({ id: 'ann1' })] })));
  receive?.({ type: 'mx:annotation-layout', nonce: 'private', positions: [{ id: 'ann1', rect: { x: 10, y: 20, width: 50, height: 20 }, status: 'exact' }] });
  expect(view.getByRole('button', { name: 'Open annotation ann1' })).toHaveStyle({ top: '60px' });
});
