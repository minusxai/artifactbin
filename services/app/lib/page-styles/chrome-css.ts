

/**
 * TABLES, in every document. A table is its own horizontal scroll box, capped
 * at its column: a wide one scrolls inside the column rather than pushing the
 * page sideways (which is what a 3-column table did to a phone, cut mid-word
 * with nothing to say so). `fit-content` makes it hug its rows by default; an
 * author's `w-full` still wins, because a utility outranks `:where`. The fade
 * is the affordance — shown on a table that CAN scroll (marked by
 * lib/islands/table-scroll from the every-document entry) and dropped
 * once the reader reaches the last column, where nothing is hidden any more.
 */
export const STORY_TABLE_CSS = `
/*
 * The kit's own <DataTable> opts OUT by its marker. A scroll box here is not
 * just redundant — the kit already wraps the table in one — it is breaking: a
 * sticky <thead> pins to its nearest SCROLLING ancestor, so an overflow on the
 * table makes the table itself that ancestor and the header scrolls away with
 * the rows instead of holding at the top of the box.
 */
:where([data-mx-story-root]) table:not([data-mx-kit-table]) {
  display: block; width: fit-content; max-width: 100%; overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
:where([data-mx-story-root]) table[data-mx-scrollable] {
  mask-image: linear-gradient(to right, black calc(100% - 36px), transparent);
  -webkit-mask-image: linear-gradient(to right, black calc(100% - 36px), transparent);
}
:where([data-mx-story-root]) table[data-mx-scrollable="end"] { mask-image: none; -webkit-mask-image: none; }
`;
