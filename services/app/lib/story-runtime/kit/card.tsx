/** The `card` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<Card>`, `<CardHeader>`, `<CardTitle>`, and the rest of its family. */
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } from '@/components/kit/card';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardAction } };
