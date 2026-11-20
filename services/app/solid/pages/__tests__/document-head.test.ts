/**
 * The version the document page shows names it: a rename holds until a newer version is announced with its own title,
 * the browser tab follows, and new comments are made against the newest edit id shown.
 */
import { expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { renderHook } from '../../__tests__/helpers';
import { createDocumentHead } from '../document-head';

type Step = { rename?: string; publish?: [string | null, number]; live?: { version: number; editId: string } };

it.each<{ case: string; steps: Step[]; title: string; editId: string }>([
  { case: 'the served title', steps: [], title: 'Served', editId: 'e1' },
  { case: 'a rename', steps: [{ rename: 'Renamed' }], title: 'Renamed', editId: 'e1' },
  { case: 'a newer announced version over a rename', steps: [{ rename: 'Renamed' }, { live: { version: 2, editId: 'e2' } }, { publish: ['Announced', 2] }], title: 'Announced', editId: 'e2' },
  { case: 'a rename after an announced version', steps: [{ live: { version: 2, editId: 'e2' } }, { publish: ['Announced', 2] }, { rename: 'Mine' }], title: 'Mine', editId: 'e2' },
])('$case', ({ steps, title, editId }) => {
  const { result } = renderHook(() => {
    const [live, setLive] = createSignal<{ version: number; editId: string } | null>(null);
    return { head: createDocumentHead({ served: { version: 1, editId: 'e1' }, archivedVersion: undefined, surface: { title: 'Served' }, live }), setLive };
  });
  for (const step of steps) {
    if (step.live) result.setLive(step.live);
    if (step.publish) result.head.published(...step.publish);
    if (step.rename) result.head.renamed(step.rename);
  }
  expect(result.head.title()).toBe(title);
  expect(result.head.editId()).toBe(editId);
});
