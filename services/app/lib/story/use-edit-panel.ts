'use client';

import { useEffect, useState } from 'react';
import { EDIT_PANEL_STRIP_W, RIGHT_RAIL_W, isWideEditViewport } from './edit-bar';

/**
 * Is the window wide enough for the edit panel to sit beside the document
 * (edit-bar's EDIT_PANEL_BREAKPOINT)? LIVE, like useIsPhoneViewport: a window
 * dragged across the line swaps the side panel for bottom sheets.
 */
export function useWideEditViewport(): boolean {
  const [wide, setWide] = useState(() => isWideEditViewport());
  useEffect(() => {
    const onResize = () => setWide(isWideEditViewport());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return wide;
}

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
