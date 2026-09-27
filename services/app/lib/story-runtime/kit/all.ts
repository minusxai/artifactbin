/**
 * EVERY kit chunk, registered at once — for the renderers that draw in one
 * synchronous pass and fetch nothing: the server's (ssr-entry), the offline
 * file's, and the test suites'. The reader runtimes never import this: they
 * load the chunks a document draws (../kit-registry).
 */
import type { KitChunkId } from '@/lib/story-ui/kit-chunks';
import { registerKitChunk, type KitChunk } from '../kit-registry';
import { chunk as card } from './card';
import { chunk as badge } from './badge';
import { chunk as alert } from './alert';
import { chunk as table } from './table';
import { chunk as separator } from './separator';
import { chunk as skeleton } from './skeleton';
import { chunk as progress } from './progress';
import { chunk as breadcrumb } from './breadcrumb';
import { chunk as grid } from './grid';
import { chunk as file } from './file';
import { chunk as video } from './video';
import { chunk as button } from './button';
import { chunk as avatar } from './avatar';
import { chunk as tabs } from './tabs';
import { chunk as accordion } from './accordion';
import { chunk as collapsible } from './collapsible';
import { chunk as popover } from './popover';
import { chunk as dialog } from './dialog';
import { chunk as controls } from './controls';
import { chunk as slides } from './slides';
import { chunk as user } from './user';
import { chunk as signIn } from './sign-in';
import { chunk as dataTable } from './data-table';
import { chunk as files } from './files';
import { chunk as mermaid } from './mermaid';
import { chunk as deckGl } from './deck-gl';
import { chunk as iframe } from './iframe';
import { chunk as question } from './question';
import { chunk as number } from './number';

export const ALL_KIT_CHUNKS: { readonly [K in KitChunkId]: KitChunk } = { card, badge, alert, table, separator, skeleton, progress, breadcrumb, grid, file, video, button, avatar, tabs, accordion, collapsible, popover, dialog, controls, slides, user, 'sign-in': signIn, 'data-table': dataTable, files, mermaid, 'deck-gl': deckGl, iframe, question, number };

/** Register every chunk (idempotent). */
export function registerAllKitChunks(): void {
  for (const [id, chunk] of Object.entries(ALL_KIT_CHUNKS) as [KitChunkId, KitChunk][]) registerKitChunk(id, chunk);
}

registerAllKitChunks();
