/**
 * Internal: the small data-source label af-chart and af-data-table show in their own chrome
 * ("Live", "Live · paused", "Snapshot · <when>"), worded by lib/html-component-specs data-source
 * from the answer's `rows.source`. A focusable button named "Data source: …" inside an
 * af-tooltip whose content says when and as whom. Kept in place while nothing changes, so a
 * rerender never closes an open tooltip.
 * Used by: chart-frame.ts, data-table.ts.
 */
import type { DataSourceLabel } from '@/lib/html-component-specs/data-source';
import './tooltip';

/** Light-DOM styles for the label; each host's stylesheet carries them. */
export const dataSourceStyles =
  '.af-data-source{display:inline-flex;font-size:.75rem;line-height:1.2}' +
  '.af-data-source button{display:inline-flex;align-items:center;gap:.375rem;padding:0;' +
  'border:0;background:none;font:inherit;color:var(--muted-foreground,GrayText);cursor:default}' +
  '.af-data-source button:focus-visible{outline:2px solid var(--ring,Highlight);' +
  'outline-offset:2px;border-radius:var(--radius-sm,2px)}' +
  '.af-data-source[data-state=live] button::before,.af-data-source[data-state=paused] ' +
  'button::before{content:"";width:.5rem;height:.5rem;border-radius:50%;' +
  'background:var(--af-data-source-live,var(--primary,currentColor))}' +
  '.af-data-source[data-state=paused] button::before{background:none;' +
  'box-shadow:inset 0 0 0 1.5px currentColor}';

/** One host's label: shown before `before` (or at the end), replaced only when its words change. */
export class DataSourceSlot {
  private el: HTMLElement | null = null;
  private key = '';
  constructor(private readonly host: HTMLElement) {}

  show(label: DataSourceLabel | null, before: Element | null = null): void {
    const key = label ? `${label.state}|${label.text}|${label.tooltip}` : '';
    if (key === this.key && (!this.el || this.el.isConnected)) return;
    this.key = key;
    this.el?.remove();
    this.el = label ? this.build(label) : null;
    if (this.el) this.host.insertBefore(this.el, before);
  }

  private build(label: DataSourceLabel): HTMLElement {
    const doc = this.host.ownerDocument;
    const tip = doc.createElement('af-tooltip');
    tip.className = 'af-data-source';
    tip.dataset.state = label.state;
    const trigger = doc.createElement('af-tooltip-trigger');
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', label.name);
    button.textContent = label.text;
    trigger.append(button);
    const content = doc.createElement('af-tooltip-content');
    content.textContent = label.tooltip;
    tip.append(trigger, content);
    return tip;
  }
}
