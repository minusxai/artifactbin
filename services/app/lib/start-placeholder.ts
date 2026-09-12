/**
 * What a brand-new document says before an agent touches it: a centered holding
 * state with a blinking caret, because this page is what the user STARES AT
 * while they paste the instruction — a bare heading in the corner reads as a
 * broken page rather than as a document waiting its turn.
 *
 * Still deliberately ordinary markup: the first agent edit is an ordinary edit,
 * with no empty-document special case anywhere in the protocol, so the waiting
 * line stays a plain unique text anchor. The caret blinks on `animate-caret-blink`
 * (shipped by the story compile — the markup tier has no `<style>`, so custom
 * keyframes can only come from there) and is green rather than themed: this
 * document has no theme yet, and green is the one that reads as a live terminal.
 */
const WAITING_LINE = 'Waiting for your agent…';
const ACTIONABLE_LINE = 'Paste what you copied into your coding agent.';
export const START_PLACEHOLDER_MARKUP =
  '<div data-design="tw" className="@container flex min-h-[var(--mx-vh,760px)] flex-col items-center justify-center gap-4 px-6 text-center">' +
  '<h1 className="text-2xl font-semibold tracking-tight">Untitled</h1>' +
  `<p className="font-mono text-sm text-muted-foreground">${ACTIONABLE_LINE}</p>` +
  `<p className="font-mono text-xs text-muted-foreground">${WAITING_LINE}` +
  '<span className="ml-1.5 inline-block h-4 w-2 align-middle animate-caret-blink bg-emerald-500"></span>' +
  '</p></div>';
