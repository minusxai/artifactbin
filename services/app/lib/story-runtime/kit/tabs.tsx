/** The `tabs` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<Tabs>`, `<TabsList>`, `<TabsTrigger>`, and the rest of its family. */
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/kit/tabs';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { Tabs, TabsList, TabsTrigger, TabsContent } };
