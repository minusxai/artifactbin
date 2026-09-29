/* @jsxImportSource solid-js */
import { expect, it, vi } from 'vitest';
import type { StoryController } from '@/lib/story-runtime/contract';
import { render } from '../../__tests__/helpers';
import { SelectionActions } from '../SelectionActions';

it('grants only view mode capabilities and rechecks the requested action', () => {
  const send = vi.fn(); let receive: ((data: unknown) => void) | undefined;
  const controller = { send, subscribe: (callback: (data: unknown) => void) => { receive = callback; return () => {}; } } as unknown as StoryController;
  const edit = vi.fn(); const annotate = vi.fn();
  const selection = { kind: 'text', path: '0', nodeId: 'n1', tag: 'p', rect: { x: 0, y: 0, width: 1, height: 1 }, className: '', style: '', ancestors: [] };
  render(() => <SelectionActions runtimeRef={{ current: controller }} nonce="private" canEdit={false} canAnnotate editing={false} onEdit={edit} onAnnotate={annotate} />);
  expect(send).toHaveBeenCalledWith({ type: 'mx:selection-actions', edit: false, annotate: true });
  receive?.({ type: 'mx:selection-action', nonce: 'private', action: 'edit', selection });
  receive?.({ type: 'mx:selection-action', nonce: 'wrong', action: 'annotate', selection });
  expect(edit).not.toHaveBeenCalled(); expect(annotate).not.toHaveBeenCalled();
  receive?.({ type: 'mx:selection-action', nonce: 'private', action: 'annotate', selection });
  expect(annotate).toHaveBeenCalledWith(selection);
});
