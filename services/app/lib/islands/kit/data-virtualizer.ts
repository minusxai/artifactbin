import { createVirtualizer } from '@tanstack/solid-virtual';

/** The table's scrolling engine is needed only after its served rows hydrate. */
export function createDataVirtualizer(options: {
  scroll: () => HTMLDivElement;
  count: () => number;
  key: (index: number) => string | number;
  offset: () => number;
  rowHeight: number;
}) {
  return createVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    getScrollElement: options.scroll,
    get count() { return options.count(); },
    getItemKey: options.key,
    estimateSize: () => options.rowHeight,
    overscan: 12,
    initialOffset: options.offset,
  });
}
