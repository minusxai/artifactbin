/** The `alert` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<Alert>`, `<AlertTitle>`, `<AlertDescription>`. */
import { Alert, AlertTitle, AlertDescription } from '@/components/kit/alert';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { Alert, AlertTitle, AlertDescription } };
