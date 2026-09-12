/** Inert selection visuals shared by commenting, editing, and edit-handle geometry. */
const width = 1;
const offset = 3;
const outline = (opacity: number) =>
  `outline: ${width}px solid rgba(245, 158, 11, ${opacity}); outline-offset: ${offset}px; border-radius: 3px;`;

export const SELECTION_PRESENTATION = {
  selectedCss: outline(0.85),
  hoverCss: `${outline(0.9)} background: rgba(245, 158, 11, 0.08);`,
  handleOutset: offset + width / 2,
};
