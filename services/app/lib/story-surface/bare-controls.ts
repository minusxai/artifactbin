/**
 * A FIELD that looks like a field, for markup an agent left unstyled.
 *
 * Tailwind's preflight resets `input`/`textarea`/`select` to naked text —
 * `border: 0`, no padding, no radius, a transparent background — which is
 * right for a control that is about to be dressed in utilities and wrong for
 * one that never is. An agent published exactly the latter: an "add expense"
 * form whose `<input placeholder="What was it for?">` and
 * `<input type="number">` rendered as floating placeholder text beside a fully
 * framed `<DatePicker>` and a `<Button>`. `<Input>`/`<Textarea>`
 * (components/kit/controls.tsx) are the answer for new markup; this is the
 * floor under the pages that already exist, applied on their next render.
 *
 * It inherits the typography floor's safety property verbatim
 * (bare-typography.ts): `:not([class])` — the renderer adds no `class` of its
 * own, so `class` present ⇔ the AUTHOR styled it, and a styled control never
 * MATCHES these rules at all. That also keeps it off every control the kit or
 * the runtime frames itself: a `<DataTable>` cell editor, the `<Select>`
 * popup's search box and `<Input>`'s own field all carry classes.
 *
 * Two smaller decisions:
 *   - TEXT-LIKE types only. A range slider, a checkbox, a radio, a file
 *     picker, a colour well and the button-shaped inputs are not text boxes;
 *     a text box's frame would wreck each of them. `<Slider>`/`<Switch>` are
 *     the kit's answers for the first two.
 *   - Everything but the tag name sits inside `:where()`, so each rule weighs
 *     exactly one element selector. That beats preflight (equal specificity,
 *     later in the document) and loses to the author's own `<style>` block,
 *     which is the last sheet the document carries.
 *
 * Every token is read with a FALLBACK: this sheet is served to every document,
 * including legacy ones compiled before the shadcn token layer existed, and an
 * unresolvable `var()` makes the whole declaration invalid rather than falling
 * back to anything.
 */
/**
 * `type`s a themed frame must not touch — the controls that merely share the
 * `input` tag. Everything else (text, number, email, url, search, password,
 * tel, date…, and a missing `type`, which is text) is a box you type in.
 */
export const BARE_CONTROL_EXCLUDED_TYPES = [
  'range', 'checkbox', 'radio', 'file', 'color',
  // Not text boxes either: these are buttons and a value with no box at all.
  'submit', 'button', 'reset', 'image', 'hidden',
] as const;

const EXCLUDED = BARE_CONTROL_EXCLUDED_TYPES.map((t) => `:not([type=${t}])`).join('');

/**
 * `:not([class])` is the whole guarantee — see the header. The root attribute
 * is spelled out rather than imported, exactly as the typography floor spells
 * it: this module is one half of `./index`, and importing the name back out of
 * it is a cycle whose losing order is a TDZ crash. The test pins the two
 * together by asserting every selector carries `STORY_ROOT_ATTR`.
 */
const bare = (tag: string, extra = '') => `:where([data-mx-story-root]) ${tag}:where(:not([class])${extra})`;

const FIELD = bare('input', EXCLUDED);
const AREA = bare('textarea');
const PICKER = bare('select');

/**
 * The frame, in the same measurements the kit control draws: h-9, px-3,
 * rounded-md, border-input, bg-background, text-sm, shadow-xs.
 */
const FRAME = [
  'border:1px solid var(--input, ButtonBorder)',
  'border-radius:calc(var(--radius, 0.625rem) - 2px)',
  'background-color:var(--background, Field)',
  'color:var(--foreground, FieldText)',
  'padding-inline:0.75rem',
  'font-family:inherit',
  'font-size:0.875rem',
  'line-height:1.25rem',
  'box-shadow:0 1px 2px 0 rgb(0 0 0 / 0.05)',
  'max-width:100%',
].join(';');

export const STORY_BARE_CONTROLS_CSS = [
  `${FIELD},${AREA},${PICKER}{${FRAME}}`,
  // A single-line field is exactly the kit control's height; a textarea is
  // taller by nature and keeps its own rows, with the same vertical padding.
  `${FIELD},${PICKER}{height:2.25rem}`,
  `${AREA}{padding-block:0.5rem;min-height:4.5rem;resize:vertical}`,
  // The focus ring the kit draws, as an outline: a ring the reader can see is
  // the difference between a form and a set of rectangles.
  `${FIELD}:focus-visible,${AREA}:focus-visible,${PICKER}:focus-visible{outline:2px solid var(--ring, Highlight);outline-offset:1px}`,
  `${FIELD}:disabled,${AREA}:disabled,${PICKER}:disabled{cursor:not-allowed;opacity:0.5}`,
].join('');
