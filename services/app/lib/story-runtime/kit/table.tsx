/** The `table` kit chunk (lib/story-ui/kit-chunks): loaded for the documents that draw `<Table>`, `<TableHeader>`, `<TableBody>`, and the rest of its family. */
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption } from '@/components/kit/table';
import type { KitChunk } from '../kit-registry';

export const chunk: KitChunk = { faces: { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption } };
