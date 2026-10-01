import { cn } from '@/lib/cn';
import { substituteRow } from '@/lib/story/data/row-scope';

/** Merge a row's class after substitution, only in documents with authored row classes. */
export const rowClass = (base: string, authored: string, row: Record<string, unknown>): string => cn(base, substituteRow(authored, row));
