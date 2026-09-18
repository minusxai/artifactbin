/** A mutation/live update invalidates retained reads without resetting a live editor. */
export const PAGE_DATA_CHANGED = 'mx:page-data-changed';
export const pageDataChanged = () => window.dispatchEvent(new Event(PAGE_DATA_CHANGED));

/**
 * The signed-in person's own face changed — a picture uploaded or removed, a
 * handle saved (the app bar's initial is the handle's). The session is re-read
 * on THIS alone: page data changes for many unrelated reasons, and none of them
 * is a reason to ask who is signed in again.
 */
export const PROFILE_CHANGED = 'mx:profile-changed';
export const profileChanged = () => window.dispatchEvent(new Event(PROFILE_CHANGED));
