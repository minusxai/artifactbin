/**
 * `@afbin/collab`: live dataset text cells for a page (contracts region-sessions CellScope). Built as its own lazy
 * module (build.server), importing the page reader (`@afbin/reader`) for the frame's cell port only.
 *
 *   import {collab} from '@afbin/collab';
 *   const text = collab.text('tasks', row._id, 'description');  // the page's dataset link name, the row's _id, the field
 *   const binding = text.bind(textarea);                          // two-way, caret kept, IME-safe
 *   text.on('change', (value) => …); text.status;                 // 'synced' | 'pending' | 'offline' | 'readonly'
 *   text.on('error', ({reason, message, unsaved}) => …);          // why editing ended (text not saved in `unsaved`)
 *   binding.destroy(); text.destroy();
 *
 * One live text per cell: asking for the same cell again answers the same object until it is destroyed.
 */
import { cellKey } from '@artifactbin/contracts';
import { collabPort } from './browser-reader';
import { createCollabText, type CollabText } from './collab-binding';

export type { CollabText, CollabBinding, CollabError } from './collab-binding';
export type { CollabStatus } from '@artifactbin/contracts';

const texts = new Map<string, CollabText>();

export const collab = {
  text(dataset: string, rowId: string, column: string): CollabText {
    const key = cellKey({ dataset, rowId, column });
    let text = texts.get(key);
    if (!text) texts.set(key, text = createCollabText(collabPort, key, () => { if (texts.get(key) === text) texts.delete(key); }));
    return text;
  },
};
