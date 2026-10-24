/** Author-owned visibility: af-change announces a cancelable request, never persists state. */
export interface DialogChangeDetail { value: boolean }
export interface DialogContract { open: boolean | undefined }
let sequence = 0;
export class AfDialog extends HTMLElement implements DialogContract {
  static observedAttributes = ['open'];
  private local = false;
  private initialized = false;
  private supplied: boolean | undefined;
  private native: HTMLDialogElement | undefined;
  private opener: HTMLElement | null = null;
  private observer = new MutationObserver(() => this.sync());
  get open(): boolean { return this.supplied ?? (this.hasAttribute('open') || this.local); }
  set open(value: boolean | undefined) { if (value === undefined) this.local = this.open; this.supplied = value; this.sync(); }
  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'open')) { const value = this.open; delete (this as {open?: boolean}).open; this.open = value; }
    if (!this.initialized) { this.local = this.hasAttribute('default-open'); this.initialized = true; }
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.keydown);
    this.observer.observe(this, {childList:true,subtree:true,attributes:true,attributeFilter:['id','disabled']});
    this.sync();
  }
  disconnectedCallback(): void {
    this.observer.disconnect(); this.removeEventListener('click', this.onClick); this.removeEventListener('keydown', this.keydown);
    if (this.native?.open) this.native.close();
  }
  attributeChangedCallback(): void { this.sync(); }
  private own(tag: string): HTMLElement[] { return [...this.querySelectorAll<HTMLElement>(tag)].filter(n => n.closest('af-dialog') === this); }
  private intent(value: boolean, opener?: HTMLElement): void {
    if (value === this.open) return;
    if (value && opener) this.opener = opener;
    const event = new CustomEvent<DialogChangeDetail>('af-change',{detail:{value},bubbles:true,composed:true,cancelable:true});
    if (this.dispatchEvent(event) && this.supplied === undefined && !this.hasAttribute('open')) this.local = value;
    this.sync();
  }
  private onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('af-dialog') !== this) return;
    const control = event.target.closest<HTMLElement>('af-dialog-trigger,af-dialog-close');
    if (control) {
      if (control.hasAttribute('disabled') || event.target.closest(':disabled,[aria-disabled="true"]')) return;
      this.intent(control.localName === 'af-dialog-trigger', event.target.closest<HTMLElement>('button,a[href],input,[tabindex]') ?? control);
    } else if (event.target === this.native) {
      const bounds = this.native.getBoundingClientRect();
      if (event.clientX <= bounds.left || event.clientX >= bounds.right || event.clientY <= bounds.top || event.clientY >= bounds.bottom) this.intent(false);
    }
  };
  private keydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest('af-dialog') !== this) return;
    const control = event.target.closest<HTMLElement>('af-dialog-trigger,af-dialog-close');
    // Native controls generate their own keyboard click.
    if (control && event.target === control && !control.hasAttribute('disabled') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); control.click(); }
  };
  private cancel = (event: Event): void => { event.preventDefault(); this.intent(false); };
  private closed = (): void => { if (this.isConnected && this.open && !this.native?.open) this.intent(false); };
  private identify(node: HTMLElement): void { if (!node.id) { let id: string; do { id = `af-dialog-label-${++sequence}`; } while (this.ownerDocument.getElementById(id)); node.id = id; } }
  private sync(): void {
    if (!this.isConnected) return;
    const content = this.own('af-dialog-content')[0];
    if (!content) return;
    if (!this.native) {
      this.native = this.ownerDocument.createElement('dialog');
      this.native.setAttribute('data-af-dialog-native',''); this.native.tabIndex = -1;
      this.native.addEventListener('cancel',this.cancel);
      this.native.addEventListener('close',this.closed);
      content.before(this.native); this.native.append(content);
    } else if (content.parentElement !== this.native) this.native.append(content);
    for (const [tag,attribute] of [['af-dialog-title','aria-labelledby'],['af-dialog-description','aria-describedby']] as const) {
      const nodes = this.own(tag); nodes.forEach(n => this.identify(n));
      if (nodes.length) this.native.setAttribute(attribute,nodes.map(n => n.id).join(' ')); else this.native.removeAttribute(attribute);
    }
    for (const control of this.own('af-dialog-trigger,af-dialog-close')) {
      if (!control.hasAttribute('role')) control.setAttribute('role','button');
      if (!control.hasAttribute('tabindex')) control.tabIndex = 0;
      control.setAttribute('aria-disabled',String(control.hasAttribute('disabled')));
      if (control.localName === 'af-dialog-trigger') { control.setAttribute('aria-haspopup','dialog'); control.setAttribute('aria-expanded',String(this.open)); }
    }
    this.dataset.state = this.open ? 'open' : 'closed';
    if (this.open && !this.native.open) {
      this.opener ??= this.ownerDocument.activeElement as HTMLElement | null;
      this.native.showModal();
    } else if (!this.open && this.native.open) {
      this.native.close();
      if (this.opener?.isConnected) this.opener.focus();
      this.opener = null;
    }
  }
}
export class AfDialogTrigger extends HTMLElement {}
export class AfDialogContent extends HTMLElement {}
export class AfDialogHeader extends HTMLElement {}
export class AfDialogFooter extends HTMLElement {}
export class AfDialogTitle extends HTMLElement {}
export class AfDialogDescription extends HTMLElement {}
export class AfDialogClose extends HTMLElement {}
export const dialogStyles = `
af-dialog{display:contents}
dialog[data-af-dialog-native]{margin:auto;max-height:calc(100svh - 4rem);width:fit-content;max-width:min(32rem,calc(100vw - 2rem));overflow:auto;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--background);padding:1.5rem;color:var(--foreground);box-shadow:var(--shadow-lg)}
dialog[data-af-dialog-native]::backdrop{background:color-mix(in srgb,var(--foreground) 50%,transparent)}
af-dialog-content{display:flex;flex-direction:column;gap:1rem}
af-dialog-header{display:flex;flex-direction:column;gap:.5rem}
af-dialog-footer{display:flex;justify-content:flex-end;gap:.5rem}
af-dialog-title{display:block;font-size:1.125rem;font-weight:600;line-height:1}
af-dialog-description{display:block;color:var(--muted-foreground);font-size:.875rem}
af-dialog-trigger,af-dialog-close{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:var(--radius-md);padding:.5rem 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;background:var(--primary);color:var(--primary-foreground)}
af-dialog-close{border:1px solid var(--border);background:var(--background);color:var(--foreground)}
af-dialog-trigger:focus-visible,af-dialog-close:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
af-dialog-trigger[disabled],af-dialog-close[disabled]{opacity:.5;cursor:default}
`;
export function registerDialog(registry: CustomElementRegistry = customElements, document: Document = globalThis.document): void {
  if (!document.querySelector('style[data-af-dialog-styles]')) { const style = document.createElement('style'); style.setAttribute('data-af-dialog-styles',''); style.textContent = dialogStyles; document.head.append(style); }
  for (const [name,ctor] of Object.entries({'af-dialog':AfDialog,'af-dialog-trigger':AfDialogTrigger,'af-dialog-content':AfDialogContent,'af-dialog-header':AfDialogHeader,'af-dialog-footer':AfDialogFooter,'af-dialog-title':AfDialogTitle,'af-dialog-description':AfDialogDescription,'af-dialog-close':AfDialogClose})) if (!registry.get(name)) registry.define(name,ctor);
}
