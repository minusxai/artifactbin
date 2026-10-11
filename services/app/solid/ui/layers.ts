/**
 * THE APP'S ONE STACKING ORDER. z-index is not a Tailwind theme namespace, so every overlay in solid/ui takes
 * its layer from here, as an inline `z-index`: a dialog sits over the page, anything anchored (a Popover, a
 * Menu, a Select's listbox) opens above the dialog it was opened from, and a tooltip sits above both.
 * The phone bottom sheet is its own band, above the served reader chrome (lib/page-styles/chrome-css, z 2147483000).
 */
export const LAYER = {
  dialog: 150,
  popover: 200,
  tooltip: 300,
  sheetBackdrop: 2147483006,
  sheet: 2147483007,
} as const;
