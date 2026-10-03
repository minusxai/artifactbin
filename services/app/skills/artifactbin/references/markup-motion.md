---
name: markup-motion
description: >-
  Kit animation classes, custom keyframes, the scroll-reveal observer. Read only when animating beyond reveal-up and animate-fade-up.
order: 2
---
## Read first

Motion fails open: captures, exports, edit mode and reduced-motion viewers
always see the finished page.

**Kit classes** (no CSS needed):
- `reveal` `reveal-up` `reveal-left` `reveal-right` `reveal-scale`: scroll
  reveals; stagger siblings with `[transition-delay:120ms]`.
- `animate-fade-up` `animate-fade-in` `animate-scale-in`: load entrances,
  staggered with `[animation-delay:200ms]`.
- `animate-marquee`: a ticker. An `overflow-hidden` band around
  `<div className="flex w-max animate-marquee">` whose content appears TWICE
  (two identical spans); speed via `[animation-duration:20s]`.
- `animate-float` (ambient bob), `animate-caret-blink` (terminal caret).

## Your own motion

- `@keyframes` in the Helmet `<style>`; guard loops with
  `@media (prefers-reduced-motion: reduce)`.
- A custom scroll reveal: stamp the element `data-reveal`, hide it under
  `:root[data-mx-motion] .your-class:not([data-mx-seen])`, give it a
  transition. The platform observer stamps `data-mx-seen` when the reader
  reaches it; `data-mx-motion` exists only in the live view.
- Anything beyond CSS (scroll-linked values, physics, a library) is the
  [script](markup-scripts.md).
