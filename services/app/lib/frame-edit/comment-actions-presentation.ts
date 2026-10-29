/** Shared inert selection-action CSS. This leaf intentionally imports no editor or annotation presentation. */
export const COMMENT_ACTIONS_CSS = `
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
`;

// probe: pull request lane type check timing
