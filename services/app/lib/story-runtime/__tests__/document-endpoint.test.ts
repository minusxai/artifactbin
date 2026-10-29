import { describe, expect, it, vi } from 'vitest';
import type { StoryController } from '../contract';
import { documentReady, documentRect, sendDocument, subscribeDocument } from '../document-endpoint';

function controller() {
  const listeners = new Set<(data: unknown) => void>();
  const rect = { x: 1, y: 2, width: 3, height: 4 } as DOMRect;
  const value = {
    send: vi.fn(),
    subscribe: vi.fn((listener: (data: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); }),
    getViewportRect: () => rect,
  } as unknown as StoryController;
  return { value, rect, emit: (data: unknown) => listeners.forEach(listener => listener(data)) };
}

describe('the document endpoint', () => {
  it('sends to, subscribes to and measures the current controller, wrapping events as { data }', () => {
    const live = controller(), target = { runtimeRef: { current: live.value } };
    expect(documentReady(target)).toBe(true);
    sendDocument(target, { type: 'mx:data' });
    expect(live.value.send).toHaveBeenCalledWith({ type: 'mx:data' });
    const seen: unknown[] = [];
    const stop = subscribeDocument(target, event => seen.push(event));
    live.emit('ping');
    stop();
    live.emit('after');
    expect(seen).toEqual([{ data: 'ping' }]);
    expect(documentRect(target)).toBe(live.rect);
  });

  it('is inert without a controller: nothing is sent, the unsubscribe is a no-op and there is no rect', () => {
    const target = { runtimeRef: { current: null } };
    expect(documentReady(target)).toBe(false);
    expect(() => sendDocument(target, 'lost')).not.toThrow();
    const stop = subscribeDocument(target, () => { throw new Error('never'); });
    expect(() => stop()).not.toThrow();
    expect(documentRect(target)).toBeUndefined();
  });

  it('reads the controller at call time, so one that starts later is reached', () => {
    const target: { runtimeRef: { current: StoryController | null } } = { runtimeRef: { current: null } };
    const late = controller();
    target.runtimeRef.current = late.value;
    sendDocument(target, 'now');
    expect(late.value.send).toHaveBeenCalledWith('now');
  });
});
