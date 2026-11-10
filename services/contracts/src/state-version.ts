/**
 * `data-af-state-version` on a page's `<script type="application/json" data-af="state">`: the page's state version.
 * When it changes, every viewer's saved overrides are cleared once (lib/html-runtime/viewer-overrides). Like
 * `data-af-comment-version` it is the author's to bump; an invalid value is ignored (and publish warns, lib/html-autofix).
 */
export const STATE_VERSION_ATTRIBUTE = 'data-af-state-version';
/** 1-64 letters, digits, `.`, `_` or `-`. */
export const isStateVersion = (value: string): boolean => /^[A-Za-z0-9._-]{1,64}$/.test(value);
