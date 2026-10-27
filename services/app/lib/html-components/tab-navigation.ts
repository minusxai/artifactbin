/**
 * Internal: af-tabs keyboard navigation, shared types and light-DOM styles; not a public entry.
 * Used by: tabs.ts.
 */
/** Author-owned selection; components emit intent and never persist viewer state. */
export interface TabsChangeDetail { value: string }
export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsActivationMode = 'automatic' | 'manual';
export interface TabsContract { value: string | undefined }
/** Navigation among the enabled triggers, independent of DOM focus and selection. */
export interface TabNavigation {
  key:string;
  index:number;
  count:number;
  orientation:'horizontal'|'vertical';
  dir:'ltr'|'rtl';
  loop:boolean;
}
export function tabFocusTarget({key,index,count,orientation,dir,loop}:TabNavigation):number|null {
  if(count<1)return null;
  if(key==='Home')return 0;
  if(key==='End')return count-1;
  const forward=orientation==='vertical'?'ArrowDown':dir==='rtl'?'ArrowLeft':'ArrowRight';
  const backward=orientation==='vertical'?'ArrowUp':dir==='rtl'?'ArrowRight':'ArrowLeft';
  if(key!==forward&&key!==backward)return null;
  const next=index+(key===forward?1:-1);
  return loop?(next+count)%count:Math.max(0,Math.min(count-1,next));
}
/** Light DOM styles may be bundled once by the author runtime. */
export const tabsStyles =
  `\naf-tabs{display:flex;gap:.5rem;flex-direction:column}\n` +
  `af-tabs[orientation=vertical]{flex-direction:row}\naf-tabs-list{box-sizing:border-box;` +
  `display:inline-flex;align-items:center;justify-content:center;width:fit-content;height:36px;` +
  `padding:3px;border-radius:var(--radius-lg,var(--radius,.625rem));background:var(--muted,` +
  `#eee);color:var(--muted-foreground,#555)}\n` +
  `af-tabs-list[data-orientation=vertical]{height:fit-content;flex-direction:column}\n` +
  `af-tabs-trigger{box-sizing:border-box;position:relative;display:inline-flex;flex:1;` +
  `align-items:center;justify-content:center;gap:.375rem;height:calc(100% - 1px);` +
  `cursor:pointer;border:1px solid transparent;padding:4px 8px;border-radius:var(--radius-md,` +
  `calc(var(--radius,.625rem) - 2px));font-family:inherit;font-size:14px;font-weight:500;` +
  `line-height:20px;white-space:nowrap;color:var(--muted-foreground,#555);` +
  `transition:background-color .15s,color .15s,box-shadow .15s}\n` +
  `af-tabs-list[data-orientation=vertical]>af-tabs-trigger{width:100%;` +
  `justify-content:flex-start}\naf-tabs-trigger[disabled]{opacity:.5;cursor:default;` +
  `pointer-events:none}\n` +
  `af-tabs-trigger[data-state=inactive]:hover{background:color-mix(in srgb,var(--foreground,` +
  `#222) 10%,transparent);color:var(--foreground,#222)}\n` +
  `af-tabs-trigger[data-state=active]{background:var(--primary,#222);` +
  `color:var(--primary-foreground,#fff);box-shadow:0 1px 2px #0000000d}\n` +
  `af-tabs-trigger:focus-visible{z-index:10;outline:2px solid transparent;outline-offset:2px;` +
  `box-shadow:0 0 0 2px color-mix(in oklab,var(--ring,#777) 50%,transparent),` +
  `0 1px 2px #0000000d}\naf-tabs-trigger>svg{pointer-events:none;flex-shrink:0;width:1rem;` +
  `height:1rem}\naf-tabs-list[data-variant=line]{background:transparent;gap:.25rem;` +
  `border-radius:0}\n` +
  `af-tabs-list[data-variant=line]>af-tabs-trigger[data-state=active]{background:transparent;` +
  `color:var(--foreground,#222);box-shadow:none}\n` +
  `af-tabs-list[data-variant=line]>af-tabs-trigger::after{position:absolute;content:"";` +
  `background:var(--primary,#222);opacity:0;transition:opacity .15s}\n` +
  `af-tabs-list[data-variant=line][data-orientation=horizontal]>af-tabs-trigger::after{left:0;` +
  `right:0;bottom:-5px;height:2px}\n` +
  `af-tabs-list[data-variant=line][data-orientation=vertical]>af-tabs-trigger::after{top:0;` +
  `bottom:0;right:-4px;width:2px}\n` +
  `af-tabs-list[data-variant=line]>af-tabs-trigger[data-state=active]::after{opacity:1}\n` +
  `af-tabs-content{flex:1;outline:none}\naf-tabs-content[hidden]{display:none!important}\n`;
