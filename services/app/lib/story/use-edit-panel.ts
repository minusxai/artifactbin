import { EDIT_PANEL_STRIP_W, RIGHT_RAIL_W } from './edit-bar';

/**
 * The viewer's collapse choice for the edit panel. Per viewer, in this browser
 * only — a convenience, so storage that throws or comes back empty means
 * "expanded", never an error.
 */
const COLLAPSED_KEY = 'mx:edit-panel-collapsed';

export function readEditPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeEditPanelCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSED_KEY, '1');
    else window.localStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // A private window or blocked storage: the choice lasts this session only.
  }
}

/** The width the panel occupies on a wide window. */
export const editPanelWidth = (collapsed: boolean) => (collapsed ? EDIT_PANEL_STRIP_W : RIGHT_RAIL_W);
