/**
 * Internal: what af-chart owns inside itself and the states it shows. The plot (role=img, named
 * by the label), the status line (role=status, aria-live) and the values table (a <details>);
 * the drawing on show and its teardown. Loading keeps the current drawing in place; empty,
 * waiting and failed take it down. Only a drawing sets data-af-chart="ready".
 * Used by: chart.ts.
 */
import { failureOf, markFailure, type ReadFailure } from '@/lib/html-component-specs/read-failure';
import { heightOf, labelOf, valuesTable, type ChartRows } from './chart-model';
import type { BuiltChart, ChartDrawing } from './chart-render';

const THEME_ATTRIBUTES = ['data-af-dark', 'data-af-design-system', 'class', 'style'];
/**
 * Watch the element's width and the page's theme (light/dark, design system, the root's class
 * and style, the reader's colour scheme); returns the cleanup that disconnects all of it.
 */
export function observeChart(host: HTMLElement, resized: () => void,
  retheme: () => void): () => void {
  const view = host.ownerDocument.defaultView!;
  const resize = new view.ResizeObserver(resized);
  resize.observe(host);
  const theme = new view.MutationObserver(retheme);
  theme.observe(host.ownerDocument.documentElement, { attributes: true,
    attributeFilter: THEME_ATTRIBUTES });
  const media = view.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', retheme);
  return () => {
    resize.disconnect();
    theme.disconnect();
    media?.removeEventListener?.('change', retheme);
  };
}

/** A draw function's result and the abort its context's signal follows. */
export type ChartDrawn = { result: ChartDrawing; abort: AbortController };
export type ChartState = 'loading' | 'empty' | 'idle' | 'error';
/** Finalize what a draw function returned, if it returned anything to finalize. */
export const endDrawing = (drawing: ChartDrawing) =>
  (drawing as { finalize?(): void } | undefined)?.finalize?.();

export class ChartFrame {
  readonly plot: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly values: HTMLDetailsElement;
  built: BuiltChart | null = null;
  private drawing: ChartDrawn | null = null;
  private hasRows = false;

  constructor(private readonly host: HTMLElement) {
    const doc = host.ownerDocument;
    this.plot = doc.createElement('div');
    this.plot.className = 'af-chart-plot';
    this.status = doc.createElement('p');
    this.status.className = 'af-chart-status';
    this.status.hidden = true;
    this.values = doc.createElement('details');
    this.values.className = 'af-chart-values';
    this.values.hidden = true;
    const summary = doc.createElement('summary');
    summary.textContent = 'Values in this chart';
    this.values.append(summary);
  }

  /** Put the parts in the element (after any author children, such as the JSON script). */
  attach(): void {
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.plot.setAttribute('role', 'img');
    this.host.append(this.plot, this.status, this.values);
  }

  get busy(): boolean { return this.host.getAttribute('aria-busy') === 'true'; }
  set busy(value: boolean) {
    if (value) this.host.setAttribute('aria-busy', 'true');
    else this.host.removeAttribute('aria-busy');
  }

  /** The plot's height: the slot's, or the drawing's own when undefined. */
  size(height: number | undefined): void {
    this.plot.style.height = height === undefined ? '' : `${height}px`;
  }

  label(spec: Record<string, unknown> | null): void {
    this.plot.setAttribute('aria-label', labelOf(this.host, spec));
  }

  /** Show a finished drawing: its rows in the table, the ready marker and event. */
  show(rows: ChartRows, columns: string[], spec: Record<string, unknown> | null,
    drawing: BuiltChart | ChartDrawn, box: HTMLElement, truncated = false): void {
    this.clear();
    this.plot.replaceChildren(box);
    if ('view' in drawing) this.built = drawing;
    else this.drawing = drawing;
    this.label(spec);
    markFailure(this.host, null);
    this.status.hidden = !truncated;
    this.status.textContent = truncated ? `First ${rows.length} rows; the rest was cut off.` : '';
    this.busy = false;
    this.host.setAttribute('data-af-chart', 'ready');
    this.values.replaceChildren(this.values.firstElementChild!,
      ...valuesTable(this.host.ownerDocument, rows, columns));
    this.hasRows = rows.length > 0;
    this.table();
    this.host.dispatchEvent(new CustomEvent('af-chart-ready', { bubbles: true,
      detail: { view: this.built?.view ?? null, rows } }));
  }

  /** The values table follows the `table` attribute once there are rows to list. */
  table(): void {
    this.values.hidden = this.host.getAttribute('table') === 'false' || !this.hasRows
      || this.host.getAttribute('data-af-chart') !== 'ready';
  }

  /** Loading, empty, waiting or failed: the status says which. */
  state(text: string, kind: ChartState): void {
    this.host.removeAttribute('data-af-chart');
    markFailure(this.host, null);
    this.busy = kind === 'loading';
    if (kind === 'loading' && (this.built || this.drawing)) return;
    if (kind === 'loading') this.size(heightOf(this.host));
    else {
      this.clear();
      this.size(undefined);
    }
    this.values.hidden = true;
    this.status.hidden = false;
    this.status.dataset.kind = kind;
    this.status.textContent = text;
  }

  fail(problem: ReadFailure | string): void {
    const failure = failureOf(problem);
    this.state(failure.message, 'error');
    markFailure(this.host, failure, 'af-chart-error');
  }

  /** Finalize the current drawing (its view, or a draw function's result) and empty the plot. */
  clear(): void {
    this.built?.view.finalize();
    this.built = null;
    if (this.drawing) {
      this.drawing.abort.abort();
      endDrawing(this.drawing.result);
      this.drawing = null;
    }
    this.plot.replaceChildren();
  }
}
