/** A mutation/live update invalidates retained reads without resetting a live editor. */
export const PAGE_DATA_CHANGED = 'mx:page-data-changed';
export const pageDataChanged = () => window.dispatchEvent(new Event(PAGE_DATA_CHANGED));
