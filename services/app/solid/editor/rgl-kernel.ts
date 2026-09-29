/**
 * react-grid-layout's collision/compaction KERNEL (build/utils: moveElement, compact) without the
 * React component around it — the part of RGL whose output IS the grid contract (diffLayouts'
 * input). Its module requires React for one helper (childrenEqual) the kernel never calls; a Solid
 * bundle should resolve that `react` to an empty stub for this importer only (the earlier P3 probe's
 * probe-solid/vite.config.mts did); under vitest `react` resolves normally.
 */
// @ts-expect-error — RGL ships no types for build/utils; the two signatures below are its documented ones.
import * as utils from 'react-grid-layout/build/utils';

export interface LayoutItem { i: string; x: number; y: number; w: number; h: number; static?: boolean; moved?: boolean }
type Kernel = {
  moveElement(layout: LayoutItem[], item: LayoutItem, x: number, y: number, user: boolean, prevent: boolean, compact: 'vertical', cols: number): LayoutItem[];
  compact(layout: LayoutItem[], type: 'vertical', cols: number): LayoutItem[];
};
const kernel = ((utils as { default?: Kernel }).default ?? utils) as Kernel;
export const moveElement = kernel.moveElement;
export const compact = kernel.compact;
