/**
 * The platform stylesheet of a region WHILE IT IS EDITED (shipped inside `@afbin/regions`, never to readers).
 *
 * The editor's blocks are flat (lib/live-regions/schema): a list item is `<p data-list="bullet" data-depth="2">`, a
 * quoted paragraph `<p data-quote>`. The saved page nests them (`<ul><li><p>`, `<blockquote><p>`), so these rules
 * draw the flat blocks the way the browser draws the nested ones: 40px per list level and per quote, bullets that
 * change with depth (disc, circle, square), and numbers that count each run of ordered items at its own depth (a
 * deeper item between two items does not restart the outer count; any other block does). Markers are `::before`
 * boxes, not `::marker` (Safari draws no `::marker` content). Everything is scoped to the editing root.
 */
const ROOT = '[data-af-region-editor]';
const DEPTHS = [1, 2, 3, 4, 5, 6];
const BULLETS = ['\\2022', '\\25E6', '\\25AA'];

function listRules(): string {
  const rules: string[] = [];
  const item = (depth: number, list = '') => `${ROOT}>[data-list${list ? `="${list}"` : ''}][data-depth="${depth}"]`;
  for (const depth of DEPTHS) {
    rules.push(`${item(depth)}{--af-list:${depth * 40}px;position:relative}`);
    rules.push(`${item(depth, 'bullet')}::before{content:"${BULLETS[Math.min(depth, 3) - 1]}"}`);
    rules.push(`${item(depth, 'ordered')}{counter-increment:af-list-${depth}}`);
    rules.push(`${item(depth, 'ordered')}::before{content:counter(af-list-${depth}) "."}`);
    // Where a run of ordered items at this depth starts: first in the region, after a block that is not a list item,
    // after a bullet item at this depth, after a shallower item, or where a quote starts or ends.
    const starts = [
      `${item(depth, 'ordered')}:first-child`,
      `${ROOT}>:not([data-list])+${item(depth, 'ordered').slice(ROOT.length + 1)}`,
      `${item(depth, 'bullet')}+${item(depth, 'ordered').slice(ROOT.length + 1)}`,
      `${ROOT}>[data-quote]+${item(depth, 'ordered').slice(ROOT.length + 1)}:not([data-quote])`,
      `${ROOT}>:not([data-quote])+${item(depth, 'ordered').slice(ROOT.length + 1)}[data-quote]`,
      ...DEPTHS.filter((shallower) => shallower < depth).map((shallower) => `${item(shallower)}+${item(depth, 'ordered').slice(ROOT.length + 1)}`),
    ];
    rules.push(`${starts.join(',')}{counter-reset:af-list-${depth}}`);
  }
  rules.push(`${ROOT}>[data-list]::before{position:absolute;right:100%;margin-right:.5em;white-space:nowrap;font-variant-numeric:tabular-nums}`);
  return rules.join('\n');
}

const REGION_EDITOR_CSS = [
  // ProseMirror's own requirements (prosemirror-view/style/prosemirror.css).
  `${ROOT}{white-space:pre-wrap;white-space:break-spaces;word-wrap:break-word;font-variant-ligatures:none;font-feature-settings:"liga" 0}`,
  `${ROOT} pre{white-space:pre-wrap}`,
  `${ROOT}.ProseMirror-hideselection *::selection{background:transparent}`,
  `${ROOT}.ProseMirror-hideselection{caret-color:transparent}`,
  `${ROOT} .ProseMirror-separator{display:inline!important;border:none!important;margin:0!important}`,
  `${ROOT}:focus{outline:2px solid color-mix(in srgb,currentColor 18%,transparent);outline-offset:4px}`,
  // A quote is the browser's <blockquote> (40px each side); a list level adds 40px.
  `${ROOT}>[data-quote]{--af-quote:40px;margin-right:40px}`,
  `${ROOT}>[data-list],${ROOT}>[data-quote]{margin-left:calc(var(--af-quote,0px) + var(--af-list,0px))}`,
  listRules(),
  `${ROOT}>[data-task]::before{content:none}`,
  `${ROOT}>[data-task]>input[type=checkbox]{position:absolute;right:100%;margin-right:.5em;top:.25em;cursor:pointer}`,

].join('\n');

/** Installs the stylesheet once per document. */
export function installRegionEditorStyles(doc: Document): void {
  if (doc.head.querySelector('style[data-af="region-editor"]')) return;
  const style = doc.createElement('style');
  style.setAttribute('data-af', 'region-editor');
  style.textContent = REGION_EDITOR_CSS;
  doc.head.append(style);
}
