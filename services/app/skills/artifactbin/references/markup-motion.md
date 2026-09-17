---
name: markup-motion
description: >-
  Kit animation classes, custom keyframes, the scroll-reveal observer. Read only when animating beyond reveal-up and animate-fade-up.
order: 2
---
## Read first

Think in moments, not effects: a page-load sequence for the hero, scroll
reveals for each section's evidence, hover micro-interactions on what is
interactive, at most one ambient loop for atmosphere. One orchestrated
moment lands harder than scattered effects. Everything fails open —
captures, exports, edit mode, and reduced-motion viewers always see the
finished, fully visible page.

**Kit shortcuts** (one class, no CSS needed):
- `reveal` `reveal-up` `reveal-left` `reveal-right` `reveal-scale` —
  prebuilt scroll reveals; stagger siblings with
  `[transition-delay:120ms]`, `[transition-delay:240ms]`.
- `animate-fade-up` `animate-fade-in` `animate-scale-in` — hero load
  entrances, staggered with `[animation-delay:200ms]`.
- `animate-marquee` — a real ticker: `overflow-hidden` band around
  `<div className="flex w-max animate-marquee">` whose content appears
  TWICE (two identical spans); speed via `[animation-duration:20s]`.
- `animate-float` (one ambient bob), `animate-caret-blink` (terminal caret).

## Your own motion

- **Custom animation**: define `@keyframes` in your `<style>` block and
  attach them to classes — any easing, any choreography. Guard loops with
  `@media (prefers-reduced-motion: reduce)` in your CSS.
- **Scroll reveals, custom** (you don't write the watcher — the platform
  observer does the watching): stamp the element `data-reveal`, hide it under
  `:root[data-mx-motion] .your-class:not([data-mx-seen])`, and give it a
  transition to its natural state. The live viewer stamps `data-mx-seen`
  when the reader reaches it; the `data-mx-motion` root flag exists ONLY in
  the live view, which is what keeps captures and edit mode fully visible.
- **Hover micro-interactions**: plain Tailwind — `transition
  hover:-translate-y-1`, `hover:bg-muted` — on cards and links.
- Platform rules that always win over authored CSS: `position: fixed/sticky`
  is stripped at save and `100vh` becomes the reader-viewport variable
  ([markup.md](markup.md), `<Helmet>`).
