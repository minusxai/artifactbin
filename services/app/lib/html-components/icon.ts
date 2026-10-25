import { iconMarkup } from './icon-glyphs';

/** Public author-facing properties supported by `<af-icon>`. */
interface AfIconContract { name: string; size: string | number; label: string | null }
const DEFAULT_SIZE = '16';
const DEFAULT_CLASS = 'inline-block shrink-0 align-[-0.125em]';

function safeSize(value: string | number | null): string {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? String(value) : DEFAULT_SIZE;
  if (value && /^(?:\d+(?:\.\d+)?)(?:px|em|rem|ch|vw|vh|%)?$/.test(value.trim())) return value.trim();
  return DEFAULT_SIZE;
}

let nextId = 0;
export class AfIcon extends HTMLElement implements AfIconContract {
  static observedAttributes = ['name', 'size', 'stroke-width', 'theme', 'label', 'aria-label', 'class'];
  private nameIsSet = false;
  private propertyName = '';
  private sizeIsSet = false;
  private propertySize: string | number = DEFAULT_SIZE;
  private labelIsSet = false;
  private propertyLabel: string | null = null;
  private svg: SVGSVGElement | undefined;

  get name(): string { return this.nameIsSet ? this.propertyName : this.getAttribute('name') ?? ''; }
  set name(value: string) { this.nameIsSet = true; this.propertyName = String(value ?? ''); this.sync(); }
  get size(): string | number { return this.sizeIsSet ? this.propertySize : this.getAttribute('size') ?? DEFAULT_SIZE; }
  set size(value: string | number) { this.sizeIsSet = true; this.propertySize = value; this.sync(); }
  get label(): string | null { return this.labelIsSet ? this.propertyLabel : this.getAttribute('label'); }
  set label(value: string | null) { this.labelIsSet = true; this.propertyLabel = value === null ? null : String(value); this.sync(); }

  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'name')) { const value = this.name; delete (this as {name?: string}).name; this.name = value; }
    if (Object.prototype.hasOwnProperty.call(this, 'size')) { const value = this.size; delete (this as {size?: string | number}).size; this.size = value; }
    if (Object.prototype.hasOwnProperty.call(this, 'label')) { const value = this.label; delete (this as {label?: string | null}).label; this.label = value; }
    this.sync();
  }
  attributeChangedCallback(): void { this.sync(); }

  private sync(): void {
    if (!this.isConnected) return;
    this.svg = this.querySelector<SVGSVGElement>('svg[data-af-icon]') ?? this.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (!this.svg.hasAttribute('data-af-icon')) {
      let id: string;
      do { id = `af-icon-${++nextId}`; } while (this.ownerDocument.getElementById(id));
      this.svg.setAttribute('data-af-icon', '');
      this.svg.setAttribute('data-af-icon-id', id);
      this.prepend(this.svg);
    }

    const markup = iconMarkup(this.name);
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const source = parsed.documentElement;
    this.svg.replaceChildren();
    for (const child of [...source.children]) this.svg.append(this.ownerDocument.importNode(child, true));
    this.svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    this.svg.setAttribute('width', safeSize(this.size));
    this.svg.setAttribute('height', safeSize(this.size));
    this.svg.setAttribute('viewBox', '0 0 24 24');
    this.svg.setAttribute('fill', 'none');
    this.svg.setAttribute('stroke', 'currentColor');
    this.svg.setAttribute('stroke-width', this.getAttribute('stroke-width') ?? '2');
    this.svg.setAttribute('stroke-linecap', 'round');
    this.svg.setAttribute('stroke-linejoin', 'round');
    this.svg.setAttribute('class', ['lucide', source.getAttribute('class')?.split(/\s+/).filter(c => c.startsWith('lucide-')).join(' '), DEFAULT_CLASS, this.getAttribute('class')].filter(Boolean).join(' '));
    this.svg.setAttribute('data-slot', 'icon');
    const theme = this.getAttribute('theme');
    if (theme && /^(light|dark|auto)$/.test(theme)) this.svg.setAttribute('data-af-theme', theme);
    else this.svg.removeAttribute('data-af-theme');

    const label = this.getAttribute('aria-label') ?? this.label;
    if (label !== null && label.trim() !== '') {
      this.svg.setAttribute('aria-label', label);
      this.svg.setAttribute('role', 'img');
      this.svg.removeAttribute('aria-hidden');
      this.svg.removeAttribute('focusable');
    } else {
      this.svg.removeAttribute('aria-label');
      this.svg.removeAttribute('role');
      this.svg.setAttribute('aria-hidden', 'true');
      this.svg.setAttribute('focusable', 'false');
    }
  }
}

const iconStyles = `
af-icon{display:inline;color:inherit}
af-icon>svg[data-af-icon]{display:inline-block;vertical-align:-.125em;flex:none;color:inherit;stroke:currentColor}
`;

export function registerIcon(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-icon-styles]')) {
    const style = document.createElement('style'); style.setAttribute('data-af-icon-styles', ''); style.textContent = iconStyles; document.head.append(style);
  }
  if (!registry.get('af-icon')) registry.define('af-icon', AfIcon);
}
