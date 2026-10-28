/** Internal: light-DOM stylesheet for af-date-picker. Used by: date-picker.ts. */
export const datePickerStyles =
  'af-date-picker{display:inline-flex;flex-direction:column;align-items:flex-start;gap:.375rem;' +
  'vertical-align:top;position:relative;color:var(--foreground,#222);font:inherit}' +
  'af-date-picker .af-date-label{display:block;color:var(--muted-foreground,#777);' +
  'font-size:.6875rem;font-weight:500;line-height:1.5;letter-spacing:.05em;' +
  'text-transform:uppercase}' +
  'af-date-picker button{box-sizing:border-box;font:inherit;color:inherit;background:transparent;' +
  'border:1px solid var(--border,#ddd);border-radius:var(--radius-sm,calc(var(--radius,.625rem) ' +
  '- 4px));padding:.375rem;cursor:pointer}' +
  'af-date-picker .af-date-trigger{background:var(--background,#fff);display:flex;width:10rem;' +
  'align-items:center;justify-content:space-between;gap:.5rem;height:2.25rem;' +
  'border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:0 .75rem;' +
  'font-size:.875rem;line-height:1.25rem;border-color:var(--input,#ddd);box-shadow:0 1px 2px ' +
  '#0000000d}' +
  'af-date-picker .af-date-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  'af-date-picker .af-date-icon{width:1rem;height:1rem;flex-shrink:0;opacity:.5}' +
  'af-date-picker button:disabled{opacity:.3;cursor:not-allowed}' +
  'af-date-picker .af-date-trigger:focus-visible{outline:none;outline-offset:0;box-shadow:0 0 0 ' +
  '2px color-mix(in oklab,var(--ring,#777) 50%,transparent),0 1px 2px #0000000d}' +
  'af-date-picker .af-date-popup{position:fixed;inset:auto;margin:0;z-index:50;' +
  'box-sizing:border-box;width:256px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);' +
  'overflow:auto;padding:.75rem;background:var(--popover,var(--background,#fff));' +
  'color:var(--popover-foreground,var(--foreground,#222));border:1px solid var(--border,#ddd);' +
  'border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));box-shadow:var(--shadow-md,0 ' +
  '4px 6px -1px rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}' +
  'af-date-picker .af-date-popup[hidden]{display:none}' +
  'af-date-picker .af-date-header{display:flex;align-items:center;justify-content:space-between}' +
  'af-date-picker .af-date-navigation{display:flex;align-items:center;gap:.25rem}' +
  'af-date-picker .af-date-header>span{padding:0 .25rem;font-size:.875rem;font-weight:500;' +
  'line-height:1.25rem}' +
  'af-date-picker .af-date-nav{display:flex;width:28px;height:28px;align-items:center;' +
  'justify-content:center;padding:0;border:0;background:transparent;color:var(--muted-foreground,' +
  '#777);border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px))}' +
  'af-date-picker .af-date-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));' +
  'margin:.5rem 0 0;row-gap:.125rem;text-align:center}' +
  'af-date-picker .af-date-grid abbr{display:flex;width:2rem;height:2rem;align-items:center;' +
  'justify-content:center;text-decoration:none;font-size:.6875rem;font-weight:500;' +
  'line-height:1.5;color:var(--muted-foreground,#777)}' +
  'af-date-picker .af-date-grid [data-date]{display:flex;width:2rem;height:2rem;' +
  'align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--radius-sm,' +
  'calc(var(--radius,.625rem) - 4px));font-size:.875rem;line-height:1.25rem;' +
  'font-variant-numeric:tabular-nums}' +
  'af-date-picker .af-date-grid [data-date]{background:transparent}' +
  'af-date-picker .af-date-grid ' +
  '[data-date]:not([aria-pressed=true]):hover{background:var(--accent,#eee);' +
  'color:var(--accent-foreground,var(--foreground,#222))}' +
  'af-date-picker [data-adjacent=true]{color:color-mix(in srgb,var(--muted-foreground,#777) 50%,' +
  'transparent)}' +
  'af-date-picker .af-date-grid [data-date][aria-pressed=true]{background:var(--primary,#222);' +
  'color:var(--primary-foreground,#fff);font-weight:500}' +
  'af-date-picker [aria-current=date]:not([aria-pressed=true]){color:var(--primary,#222);' +
  'font-weight:600}' +
  'af-date-picker .af-date-footer{display:flex;align-items:center;justify-content:flex-end;' +
  'gap:.5rem;margin-top:.5rem;border-top:1px solid var(--border,#ddd);padding-top:.5rem;' +
  'font-size:.875rem}' +
  'af-date-picker .af-date-today{border:0;background:transparent;color:var(--primary,#222);' +
  'padding:.125rem .375rem}af-date-picker .af-date-clear{padding:.25rem .5rem}' +
  '@media(hover:hover){af-date-picker .af-date-trigger:hover{background-color:color-mix(in srgb,' +
  'var(--muted,#eee) 40%,transparent);background-color:color-mix(in oklab,var(--muted,#eee) 40%,' +
  'transparent)}}';
