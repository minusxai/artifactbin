/** A mutation/live update invalidates retained reads without resetting a live editor. */
export const PAGE_DATA_CHANGED = 'mx:page-data-changed';
export const pageDataChanged = () => window.dispatchEvent(new Event(PAGE_DATA_CHANGED));

/**
 * "Re-read what this page shows" — the one reload with no full-page-reload
 * equivalent. A full reload (`history.go(0)`) throws away state the caller
 * just set (e.g. a claim banner's result), so this is an event instead: the
 * pages that hold fetched data listen and re-fetch, and nothing else moves.
 * The single source for both the React (lib/navigation) and Solid
 * (solid/shared/page-data) call sites.
 */
export const REFRESH_EVENT = 'mx:refresh';
export const refreshPage = () => window.dispatchEvent(new Event(REFRESH_EVENT));

/**
 * The signed-in person's own face changed — a picture uploaded or removed, a
 * handle saved (the app bar's initial is the handle's). The session is re-read
 * on THIS alone: page data changes for many unrelated reasons, and none of them
 * is a reason to ask who is signed in again.
 */
export const PROFILE_CHANGED = 'mx:profile-changed';
export const profileChanged = () => window.dispatchEvent(new Event(PROFILE_CHANGED));
