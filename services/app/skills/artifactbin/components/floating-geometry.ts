/** Internal helper for af-popover, af-tooltip and af-date-picker; not a public entry point. */
export type FloatingSide = 'top' | 'bottom' | 'left' | 'right';
export interface FloatingRect { left: number; top: number; width: number; height: number }
export interface FloatingPosition { left: number; top: number; side: FloatingSide }
/** Flip toward available room, then clamp both axes even for oversized panels. */
export function floatingPosition(anchor: FloatingRect, panel: Pick<FloatingRect,'width'|'height'>,
  viewport: {width:number;height:number}, side: FloatingSide, align = 'center', offset = 4):
  FloatingPosition {
 const pad = 8;
const space = {top:anchor.top,bottom:viewport.height-anchor.top-anchor.height,left:anchor.left,
   right:viewport.width-anchor.left-anchor.width};
 const opposite = {top:'bottom',bottom:'top',left:'right',right:'left'} as const;
 const size = side === 'top' || side === 'bottom' ? panel.height : panel.width;
 if (space[side] < size + offset + pad && space[opposite[side]] > space[side]) side = opposite[side];
 const horizontal = side === 'top' || side === 'bottom';
const cross = horizontal ? anchor.left + (align === 'start' ? 0 :
   align === 'end' ? anchor.width-panel.width : (anchor.width-panel.width)/2) : anchor.top + (
   align === 'start' ? 0 : align === 'end' ? anchor.height-panel.height : (
   anchor.height-panel.height)/2);
const left = horizontal ? cross : side === 'left' ? anchor.left-panel.width-offset :
   anchor.left+anchor.width+offset;
const top = !horizontal ? cross : side === 'top' ? anchor.top-panel.height-offset :
   anchor.top+anchor.height+offset;
return {left:Math.max(pad,Math.min(left,viewport.width-panel.width-pad)),top:Math.max(pad,Math.min(
   top,viewport.height-panel.height-pad)),side};
}
