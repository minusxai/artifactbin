/**
 * WHERE THE KIT NOTES A CLASS A ROW FILLED IN (`className="{$_row.tone}"`), for ./runtime-css-session, which hides one the
 * page's sheet lacks and fetches the sheet with it. Tiny on purpose: it is in every interactive page's shared runtime,
 * and it does nothing on a page whose data names no door (no watch) or on the server.
 */
export interface ClassWatch {
  /** Every class the sheet has a rule for, or that was asked for. */
  known: Set<string>;
  /** Noted and not known: waiting to be hidden and asked for. */
  pending: Set<string>;
  /** `pending` grew. A no-op until the session loads; it then hides and asks. */
  noted(): void;
}

let watch: ClassWatch | null = null;

/** Boot sets the page's watch (and clears it on dispose); the session takes over its `noted`. */
export function watchClasses(next: ClassWatch | null): void {
  watch = next;
}

/** The classes `value` names, as the kit is about to set them. */
export function noteClasses(value: unknown): void {
  const w = watch;
  if (!w || typeof value !== 'string') return;
  let added = false;
  for (const token of value.split(/\s+/)) {
    if (token && !w.known.has(token) && !w.pending.has(token)) { w.pending.add(token); added = true; }
  }
  if (added) w.noted();
}
