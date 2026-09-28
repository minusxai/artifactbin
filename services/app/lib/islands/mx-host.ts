/** The public page API lives behind boot's lazy boundary. */
import { createMx } from '@/lib/story-runtime/mx';
import type { DataflowStore } from '@/lib/story-runtime/store';

export const publicMxFor = (store: DataflowStore) => createMx(store);
