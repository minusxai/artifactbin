import { cn } from '@/lib/islands/cn';
import { substituteRow } from '@/lib/jsx/row-scope';
import { noteClasses } from './runtime-css';

/**
 * Merge a row's class after substitution, only in documents with authored row classes. What the row filled in is
 * noted (./runtime-css): a class the document's sheet lacks is hidden until the sheet has it.
 */
export const rowClass = (base: string, authored: string, row: Record<string, unknown>): string => {
  const filled = substituteRow(authored, row);
  noteClasses(filled);
  return cn(base, filled);
};
