/** The handle namespace accounts and groups share (identity's handle reservations): its shape and reserved words. */
/** 3–32 lowercase letters/digits, with underscores only inside the handle. */
export const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,30}[a-z0-9]$/;
export const RESERVED_HANDLES = new Set(['admin','root','support','help','about','settings','security','artifactbin','artifact_bin','api','docs','mcp','oauth','a','login','tokens','www','app','mail','smtp','static','cdn','status','pages','runner','assets','blog','auth','ns1','ns2','u']);
export const isValidHandle = (handle: string): boolean => HANDLE_RE.test(handle) && !RESERVED_HANDLES.has(handle);

/** Bearer token lifetimes: the default (six hours), the shortest (one hour) and the longest (365 days). */
export const DEFAULT_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
export const MIN_TOKEN_TTL_MS = 60 * 60 * 1000;
export const MAX_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
