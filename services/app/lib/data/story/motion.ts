/**
 * The story MOTION KIT — the one contract behind every moving pixel in the
 * markup tier.
 *
 * The tier bans `<style>` and story-side JS, so motion can only come from two
 * platform pieces that this module keeps in one place:
 *
 *  1. `storyMotionKitCss()` — Tailwind INPUT (an `@theme` keyframe block +
 *     `@utility` reveal rules) interpolated into the per-story compile
 *     (story-css.server.ts). Keyframes ride `@theme`, so Tailwind emits them
 *     only for documents that actually use the utility.
 *  2. The reveal OBSERVER (lib/story-ui/use-reveal-motion.ts) — trusted
 *     parent-side code, never story code. The story iframe is CONTENT-SIZED
 *     (the parent scrolls), so CSS scroll-driven timelines can never fire
 *     inside it; instead the observer watches reveal elements against the real
 *     viewport and stamps them seen.
 *
 * The CSS contract between the two is fail-open by construction:
 *  - `.reveal-*` elements are hidden ONLY under `:root[data-mx-motion]` — the
 *    flag the observer stamps on the iframe's <html>, which sits OUTSIDE the
 *    `<svg><foreignObject>` capture subtree. Captures, exports, edit mode, and
 *    any context without the observer render everything visible.
 *  - `data-mx-seen` (stamped per element on first intersection) is a render
 *    artifact like every `data-mx-*` attr: the editor's write-back strip
 *    already removes it by prefix, so it can never leak into stored markup.
 *  - Both the hidden state and the `animate-*` loops are neutralized under
 *    `prefers-reduced-motion: reduce`.
 */

/** Root flag (iframe `<html>`) that arms reveal hiding — live read-only view only. */
const STORY_MOTION_FLAG_ATTR = 'data-mx-motion';

/** Per-element stamp: this reveal element has entered the viewport (one-way). */
const STORY_REVEAL_SEEN_ATTR = 'data-mx-seen';

/** The reveal utilities: hidden until seen, then transition to natural state. */
export const STORY_REVEAL_CLASSES = [
  'reveal',
  'reveal-up',
  'reveal-left',
  'reveal-right',
  'reveal-scale',
] as const;

/** The `animate-*` token names the kit registers (Tailwind `--animate-<name>`). */
const STORY_MOTION_ANIMATIONS = [
  'marquee',
  'fade-up',
  'fade-in',
  'scale-in',
  'float',
  'caret-blink',
] as const;

const REVEAL_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** One reveal utility: hidden start state (armed + unseen + motion-ok only). */
function revealUtility(name: string, hidden: string): string {
  return `@utility ${name} {
  transition: opacity 0.9s ${REVEAL_EASE}, translate 0.9s ${REVEAL_EASE}, scale 0.9s ${REVEAL_EASE};
  @media (prefers-reduced-motion: no-preference) {
    :root[${STORY_MOTION_FLAG_ATTR}] &:not([${STORY_REVEAL_SEEN_ATTR}]) {
      ${hidden}
    }
  }
}`;
}

/**
 * The kit as Tailwind INPUT CSS (see module doc). Pure string — client-safe;
 * the server compile (story-css.server.ts) interpolates it into TW_INPUT_JSX
 * and folds it into the compile-version hash.
 *
 * `@theme` keyframes emit only for documents using the utility. `caret-blink`
 * cuts fully off/on via `step-end` (a soft pulse reads as a glow, not a
 * caret). `marquee` expects its band content REPEATED TWICE inside an
 * `overflow-hidden` row — the -50% translate then loops seamlessly; speed is
 * tuned per band with `[animation-duration:20s]`. Entrance tokens carry `both`
 * so an `[animation-delay:…]` stagger holds the from-state while waiting.
 */
export function storyMotionKitCss(): string {
  const reveals = [
    revealUtility('reveal', 'opacity: 0;'),
    revealUtility('reveal-up', 'opacity: 0;\n      translate: 0 2.5rem;'),
    revealUtility('reveal-left', 'opacity: 0;\n      translate: -2.5rem 0;'),
    revealUtility('reveal-right', 'opacity: 0;\n      translate: 2.5rem 0;'),
    revealUtility('reveal-scale', 'opacity: 0;\n      scale: 96%;'),
  ];
  // Always-on neutralizer for the looping/entrance tokens: `animation: none`
  // drops the `both` fill too, so elements sit in their natural (visible) state.
  const neutralizer = `@media (prefers-reduced-motion: reduce) {
  ${STORY_MOTION_ANIMATIONS.map((n) => `.animate-${n}`).join(', ')} { animation: none; }
}`;
  return `@theme {
  --animate-caret-blink: caret-blink 1.1s step-end infinite;
  @keyframes caret-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  --animate-marquee: marquee 40s linear infinite;
  @keyframes marquee { to { transform: translateX(-50%); } }
  --animate-fade-up: fade-up 0.9s ${REVEAL_EASE} both;
  @keyframes fade-up { from { opacity: 0; transform: translateY(2rem); } }
  --animate-fade-in: fade-in 0.9s ease both;
  @keyframes fade-in { from { opacity: 0; } }
  --animate-scale-in: scale-in 0.9s ${REVEAL_EASE} both;
  @keyframes scale-in { from { opacity: 0; transform: scale(0.94); } }
  --animate-float: float 6s ease-in-out infinite;
  @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-0.5rem); } }
}
${reveals.join('\n')}
${neutralizer}`;
}
