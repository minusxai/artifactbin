/**
 * Internal: light-DOM stylesheet for af-markdown-editor: the field frame, toolbar and caret
 * surface. The text inside takes the shared Markdown typography (markdown-styles.ts).
 * Used by: markdown-editor.ts.
 */
import { MARKDOWN_CSS } from './markdown-styles';

const E = 'af-markdown-editor';
export const markdownEditorStyles = `${MARKDOWN_CSS}
${E}{display:flex;min-width:16rem;flex-direction:column;gap:.375rem;vertical-align:top}
${E}>label[data-af-control-label]{font-family:inherit;font-size:11px;font-weight:500;` +
  `line-height:1.5;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground,#666)}
${E}>label[hidden]{display:none}
${E}>.af-md-frame{box-sizing:border-box;display:flex;flex-direction:column;width:100%;` +
  `border:1px solid var(--input,#d1d5db);border-radius:var(--radius-md,calc(var(--radius,` +
  `.625rem) - 2px));background:var(--background,#fff);color:var(--foreground,#111);` +
  `box-shadow:0 1px 2px #0000000d;transition:box-shadow .15s}
${E}>.af-md-frame:focus-within{box-shadow:0 0 0 2px color-mix(in srgb,var(--ring,#777) 50%,` +
  `transparent)}
${E}[disabled]>.af-md-frame{cursor:not-allowed;opacity:.5}
${E} .af-md-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:4px;` +
  `border-bottom:1px solid var(--border,#e5e7eb)}
${E}[readonly] .af-md-toolbar,${E}[disabled] .af-md-toolbar{display:none}
${E} .af-md-toolbar>[role=separator]{width:1px;align-self:stretch;margin:4px;` +
  `background:var(--border,#e5e7eb)}
${E} .af-md-toolbar button{box-sizing:border-box;min-width:28px;height:28px;padding:0 6px;` +
  `border:0;border-radius:var(--radius-sm,calc(var(--radius,.625rem) - 4px));` +
  `background:transparent;color:var(--muted-foreground,#666);font:inherit;font-size:13px;` +
  `line-height:1;cursor:pointer}
${E} .af-md-toolbar button:hover{background:var(--accent,#f4f4f5);` +
  `color:var(--accent-foreground,#111)}
${E} .af-md-toolbar button[aria-pressed=true]{background:var(--secondary,#f4f4f5);` +
  `color:var(--foreground,#111)}
${E} .af-md-toolbar button:focus-visible{outline:2px solid var(--ring,#777);outline-offset:-2px}
${E} .af-md-toolbar button:disabled{opacity:.4;cursor:default}
${E} button[data-key=bold]{font-weight:700}
${E} button[data-key=italic]{font-style:italic;font-family:Georgia,serif}
${E} button[data-key=strike]{text-decoration:line-through}
${E} button[data-key=code],${E} button[data-key=code-block]{font-family:var(--font-mono,monospace)}
${E} .af-md-editable{position:relative;box-sizing:border-box;` +
  `min-height:calc(var(--af-md-rows,3) * 1.5em + 16px);padding:8px 12px;font-size:14px;` +
  `line-height:1.5;outline:none;overflow-wrap:anywhere;white-space:pre-wrap}
${E} .af-md-editable>:first-child{margin-top:0}
${E} .af-md-editable>:last-child{margin-bottom:0}
${E} .af-md-editable[data-empty]::before{content:attr(data-placeholder);position:absolute;` +
  `pointer-events:none;color:var(--muted-foreground,#737373)}
${E} .af-md-editable a{cursor:text}
${E} .af-md-editable .ProseMirror-selectednode{outline:2px solid var(--ring,#777)}
`;
