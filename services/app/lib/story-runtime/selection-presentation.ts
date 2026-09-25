/** Inert selection visuals shared by commenting, editing, and edit-handle geometry. */
const width = 1;
const offset = 3;
const outline = (color: string) => `outline: ${width}px solid ${color}; outline-offset: ${offset}px;`;
/** Authored utilities are compiled !important (a kit button's `outline-none`); edit chrome must still show. */
const important = (css: string) => css.replaceAll(';', ' !important;');
/** Slate at low alpha reads on light and dark grounds alike, so edit chrome needs no theme hook. */
const neutral = (opacity: number) => `rgba(100, 116, 139, ${opacity})`;

export const SELECTION_PRESENTATION = {
  /** Commenting keeps amber: it is the colour of every comment mark. */
  selectedCss: `${outline('rgba(245, 158, 11, 0.85)')} border-radius: 3px;`,
  /**
   * Edit mode is calm: a selected NON-TEXT block gets a thin neutral line, a
   * hovered one half that, and neither ever fills. Text gets neither — the
   * caret is its selection indicator. No border-radius: the outline must not
   * reshape an authored rounded card while the pointer is on it.
   */
  editSelectedCss: important(outline(neutral(0.55))),
  editHoverCss: important(outline(neutral(0.28))),
  /** Handles are faint until the pointer is on them. */
  handleColor: neutral(0.6),
  handleDot: neutral(0.45),
  handleActive: neutral(0.95),
  /** Pointed at from outside (the query notebook): dashed amber, so it never reads as the selection; last and important, so hover never hides it. */
  spotlightCss: important(`outline: 2px dashed rgba(245, 158, 11, 0.9); outline-offset: ${offset}px; border-radius: 3px; background: rgba(245, 158, 11, 0.06);`),
  handleOutset: offset + width / 2,
};
