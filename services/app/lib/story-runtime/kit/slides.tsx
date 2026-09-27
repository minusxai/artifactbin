/** The `slides` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<SlideDeck>`, `<Slide>`. */
import { SlideDeck, Slide } from '@/components/kit/slides';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { SlideDeck, Slide } };
