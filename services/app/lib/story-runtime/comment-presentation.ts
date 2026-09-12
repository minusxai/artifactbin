import { SELECTION_PRESENTATION } from './selection-presentation';

/** Shared inert comment chrome for markup and opaque managed frames.
 * The bootstrap serializes this data; no parent DOM or executable author capability crosses realms. */
export const COMMENT_PRESENTATION = {
  actionsCss: `
[data-mx-selection-actions] {
  all: initial; box-sizing: border-box; position: fixed; z-index: 2147483646;
  display: flex; align-items: center; overflow: hidden;
  border: 1px solid rgba(148, 163, 184, .48); border-radius: 7px;
  background: #fff; color: #344054;
  box-shadow: 0 7px 20px rgba(15, 23, 42, .16);
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: nowrap; animation: mx-selection-actions-in 90ms ease-out;
}
[data-mx-selection-actions][hidden] { display: none !important; }
:root.dark [data-mx-selection-actions] {
  border-color: rgba(148, 163, 184, .34); background: #17191d; color: #e5e7eb;
  box-shadow: 0 7px 22px rgba(0, 0, 0, .42);
}
[data-mx-selection-actions] button {
  all: unset; box-sizing: border-box; display: inline-flex; align-items: center;
  gap: 5px; min-height: 28px; padding: 0 9px; cursor: pointer; color: inherit;
}
[data-mx-selection-actions] button.mx-selection-action--coarse { min-height: 44px; padding: 0 14px; gap: 7px; }
[data-mx-selection-actions] svg { display: block; width: 13px; height: 13px; flex: none; }
[data-mx-selection-actions] button + button { border-left: 1px solid rgba(148, 163, 184, .32); }
[data-mx-selection-actions] button:hover,
[data-mx-selection-actions] button:focus-visible { background: rgba(34, 197, 94, .11); color: #16a34a; outline: none; }
@keyframes mx-selection-actions-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { [data-mx-selection-actions] { animation: none; } }
`,
  icons: {select: ['M5 3a2 2 0 0 0-2 2', 'M19 3a2 2 0 0 1 2 2', 'M21 9V7', 'M3 9V7', 'M3 13v2', 'M3 19a2 2 0 0 0 2 2', 'M7 3h2', 'M13 3h2', 'M7 21h2', 'm12 12 4 10 1.7-4.3L22 16Z'], edit: [
          'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
          'm15 5 4 4',
        ], annotate: ['M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z']},
  annotationCss: [
  `[data-mx-annotated] { background: rgba(245, 158, 11, 0.10); border-radius: 3px; transition: background 120ms; }`,
  `[data-mx-annotated]:hover { background: rgba(245, 158, 11, 0.20); }`,
  `[data-mx-annotation-open] { background: rgba(245, 158, 11, 0.26); border-radius: 3px; }`,
  `[data-mx-annotation-hover] { background: rgba(245, 158, 11, 0.18); ${SELECTION_PRESENTATION.selectedCss} }`,
  `[data-mx-annotate-selected] { ${SELECTION_PRESENTATION.selectedCss} }`,
  // The pick: a crosshair everywhere, and an outline on the block under it. The
  // doubled attribute is deliberate — it out-specifies the edit session's own
  // `[data-mx-edit-hover]` when both stamp the same node while editing.
  `[data-mx-annotate-picking], [data-mx-annotate-picking] * { cursor: crosshair !important; }`,
  // A finger drawing an area must draw, not scroll; and nothing under a band selects.
  `[data-mx-annotate-picking="area"], [data-mx-annotate-picking="area"] *, [data-mx-annotate-picking="select"], [data-mx-annotate-picking="select"] * { touch-action: none !important; user-select: none !important; }`,
  `[data-mx-annotate-pick-hover][data-mx-annotate-pick-hover] { ${SELECTION_PRESENTATION.hoverCss} }`,
  // A node whose words are painted gives up its own background — the tint is
  // what a comment looks like when we cannot find the words, not as well as.
  `[data-mx-annotated][data-mx-annotation-ranged],`
    + `[data-mx-annotated][data-mx-annotation-ranged]:hover,`
    + `[data-mx-annotation-open][data-mx-annotation-ranged],`
    + `[data-mx-annotation-hover][data-mx-annotation-ranged] { background: transparent; }`,
].join('\n'),
  highlightFill: {
  base: 'rgba(245, 158, 11, 0.28)',
  hover: 'rgba(245, 158, 11, 0.42)',
  open: 'rgba(245, 158, 11, 0.52)',
},
  bandStyle: { background: 'rgba(59, 130, 246, 0.10)', outline: 'rgba(59, 130, 246, 0.9)' },
  areaFill: {
  base: { background: 'rgba(245, 158, 11, 0.12)', outline: '2px solid rgba(245, 158, 11, 0.6)' },
  hover: { background: 'rgba(245, 158, 11, 0.2)', outline: '2px solid rgba(245, 158, 11, 0.9)' },
  open: { background: 'rgba(245, 158, 11, 0.26)', outline: '2px solid rgba(245, 158, 11, 0.9)' },
},
};
export type CommentPresentation = typeof COMMENT_PRESENTATION;
