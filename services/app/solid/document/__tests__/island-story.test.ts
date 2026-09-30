import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { STORY_ADOPT_HOOK, STORY_READER_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import type { IslandDocument } from '@/lib/islands/contract';
import { createIslandStory } from '../create-island-story';

afterEach(() => { document.body.replaceChildren(); delete (window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK]; });

it('adopts the served story, establishes its controller and hands the page its secret', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const story = document.body.appendChild(document.createElement('main'));
  story.setAttribute('data-mx-inline-story', '');
  const islands = { dispose: vi.fn(), setMode: vi.fn() } as unknown as IslandDocument;
  let dispose!: () => void;
  const island = createRoot((d) => { dispose = d; return createIslandStory({ id: 'doc', host, story, islands, nodes: [], editId: () => 'e1', source: () => null }); });
  expect(story.parentElement).toBe(host);
  expect(island.nonce()).toMatch(/.{16,}/);
  expect(island.controller()?.nonce).toBe(island.nonce());
  expect(typeof (window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK]).toBe('function');
  // The selection bubble's protected root: a trusted host whose portal the controller mounts into.
  expect(document.querySelector('[data-trusted-ui]')?.shadowRoot?.querySelector('[data-trusted-ui-root]')?.children).toHaveLength(2);
  island.controller()!.send({ type: STORY_READER_MODE_MESSAGE, mode: 'dark' });
  expect(story).toHaveProperty('className', 'dark');
  dispose();
  expect(island.nonce()).toBeNull();
  expect((window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK]).toBeUndefined();
  expect(document.querySelector('[data-trusted-ui]')).toBeNull();
  await Promise.resolve();
  expect(islands.dispose).toHaveBeenCalled();
  expect(story.isConnected).toBe(false);
});

it('never claims a hook another runtime already holds', () => {
  const held = () => {};
  (window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK] = held;
  const host = document.body.appendChild(document.createElement('div'));
  const story = document.body.appendChild(document.createElement('main'));
  let dispose!: () => void;
  createRoot((d) => { dispose = d; return createIslandStory({ id: 'doc', host, story, islands: null, nodes: [], editId: () => '', source: () => null }); });
  dispose();
  expect((window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK]).toBe(held);
});
