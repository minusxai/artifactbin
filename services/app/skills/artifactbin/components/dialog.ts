/**
 * <af-dialog>: modal dialog; af-change announces a cancelable request and never persists state.
 * Import:  import '@afbin/dialog';  (registers the tags; this .ts is the readable contract)
 * Props: open (boolean)
 * Parts: af-dialog-trigger (use a native button inside), af-dialog-content
 * Events: af-change (bubbles) with event.detail.value; reflect your Apollo value back for controlled use
 * Usage:
 *   <af-dialog><af-dialog-trigger><button>Open</button></af-dialog-trigger><af-dialog-content>Hello</af-dialog-content></af-dialog>
 */
import { registerComponent, type ComponentDescriptor } from './register-component';
/** Author-owned visibility: af-change announces a cancelable request, never persists state. */
export interface DialogChangeDetail { value: boolean }
/** Content aria-label/labelledby/describedby are forwarded; authored names outrank derived parts. */
export interface DialogContract { open: boolean | undefined }
let sequence = 0;
export class AfDialog extends HTMLElement implements DialogContract {
  static observedAttributes = ['open'];
  private local = false;
  private initialized = false;
  private supplied: boolean | undefined;
  private native: HTMLDialogElement | undefined;
  private mountedContent: HTMLElement | undefined;
  private opener: HTMLElement | null = null;
  private controlAttributes = new WeakMap<HTMLElement, {role: string | null; tab: string | null}>();
  private disabledChildren = new Map<HTMLElement, {disabled: string | null; tab: string | null}>();
  private observer = new MutationObserver(records => {
    // Native projection writes must not feed back into this observer.
    if (records.some(record => record.type === 'childList' || record.attributeName === 'id' || record.attributeName === 'disabled' ||
      (record.target instanceof Element && record.target.localName === 'af-dialog-content' && record.target.closest('af-dialog') === this))) this.sync();
  });
  get open(): boolean { return this.supplied ?? (this.hasAttribute('open') || this.local); }
  set open(value: boolean | undefined) { if (value === undefined) this.local = this.open; this.supplied = value; this.sync(); }
  connectedCallback(): void {
    if (Object.prototype.hasOwnProperty.call(this, 'open')) { const value = this.open; delete (this as {open?: boolean}).open; this.open = value; }
    if (!this.initialized) { this.local = this.hasAttribute('default-open'); this.initialized = true; }
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.keydown);
    this.observer.observe(this, {childList:true,subtree:true,attributes:true,attributeFilter:['id','disabled','aria-label','aria-labelledby','aria-describedby']});
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
    if (event.key === 'Tab' && this.native?.open && this.native.contains(event.target)) {
      const stops = [...this.native.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')].filter(node => {
        if(node.tabIndex < 0 || node.matches(':disabled,[disabled],[aria-disabled="true"]') || node.closest('[hidden],[inert],fieldset[disabled]')) return false;
        for(let ancestor: HTMLElement | null = node; ancestor && ancestor !== this.native; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor); if(style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      });
      const first = stops[0]; const last = stops.at(-1); const active = this.ownerDocument.activeElement;
      if(!stops.length || active === this.native || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus(); if(!stops.length) this.native.focus();
      }
      return;
    }
    const control = event.target.closest<HTMLElement>('af-dialog-trigger,af-dialog-close');
    // Native controls generate their own keyboard click.
    if (control && event.target === control && !control.hasAttribute('disabled') && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); control.click(); }
  };
  private cancel = (event: Event): void => { event.preventDefault(); this.intent(false); };
  private closed = (): void => { if (this.isConnected && this.open && !this.native?.open) this.intent(false); };
  private identify(node: HTMLElement): void { if (!node.id) { let id: string; do { id = `af-dialog-label-${++sequence}`; } while (this.ownerDocument.getElementById(id)); node.id = id; } }
  private restoreAttribute(node: HTMLElement, name: string, value: string | null): void { if (value === null) node.removeAttribute(name); else node.setAttribute(name,value); }
  private sync(): void {
    if (!this.isConnected) return;
    const content = this.own('af-dialog-content')[0];
    if (this.native && (content !== this.mountedContent || !content || !this.native.contains(content))) {
      const obsolete = this.native; this.native = undefined;
      obsolete.removeEventListener('cancel',this.cancel); obsolete.removeEventListener('close',this.closed);
      if (content && obsolete.contains(content)) obsolete.before(content);
      if (obsolete.open) obsolete.close(); obsolete.remove();
      if (this.opener?.isConnected) this.opener.focus(); this.opener = null;
    }
    if (!content) return;
    if (!this.native) {
      this.native = this.ownerDocument.createElement('dialog');
      this.native.setAttribute('data-af-dialog-native',''); this.native.tabIndex = -1;
      this.native.addEventListener('cancel',this.cancel);
      this.native.addEventListener('close',this.closed);
      content.before(this.native); this.native.append(content); this.mountedContent = content;
    } else if (content.parentElement !== this.native) this.native.append(content);
    this.restoreAttribute(this.native,'aria-label',content.getAttribute('aria-label'));
    for (const [tag,attribute] of [['af-dialog-title','aria-labelledby'],['af-dialog-description','aria-describedby']] as const) {
      const explicit = content.getAttribute(attribute);
      // aria-labelledby has native priority over aria-label; a derived title must not override an authored name.
      if (explicit !== null || (attribute === 'aria-labelledby' && content.hasAttribute('aria-label'))) {
        this.restoreAttribute(this.native,attribute,explicit);
      } else {
        const nodes = this.own(tag); nodes.forEach(n => this.identify(n));
        this.restoreAttribute(this.native,attribute,nodes.length ? nodes.map(n => n.id).join(' ') : null);
      }
    }
    const disabledTargets = new Set<HTMLElement>();
    for (const control of this.own('af-dialog-trigger,af-dialog-close')) {
      let authored = this.controlAttributes.get(control);
      if (!authored) { authored = {role:control.getAttribute('role'),tab:control.getAttribute('tabindex')}; this.controlAttributes.set(control,authored); }
      const child = control.querySelector<HTMLElement>('button,input,select,textarea,a[href]');
      const target = child ?? control;
      if (child) {
        this.restoreAttribute(control,'role',authored.role); this.restoreAttribute(control,'tabindex',authored.tab);
        control.removeAttribute('aria-haspopup'); control.removeAttribute('aria-expanded'); control.removeAttribute('aria-disabled');
      } else {
        control.setAttribute('role',authored.role ?? 'button'); control.tabIndex = control.hasAttribute('disabled') ? -1 : Number(authored.tab ?? 0);
      }
      const disabled = control.hasAttribute('disabled');
      if (child && disabled) {
        disabledTargets.add(child);
        if (!this.disabledChildren.has(child)) this.disabledChildren.set(child,{disabled:child.getAttribute('disabled'),tab:child.getAttribute('tabindex')});
        if ('disabled' in child && !child.hasAttribute('disabled')) child.setAttribute('disabled','');
        child.tabIndex = -1;
      }
      target.setAttribute('aria-disabled',String(disabled || (child?.hasAttribute('disabled') ?? false)));
      if (control.localName === 'af-dialog-trigger') { target.setAttribute('aria-haspopup','dialog'); target.setAttribute('aria-expanded',String(this.open)); }
    }
    for (const [child,authored] of this.disabledChildren) {
      if (disabledTargets.has(child)) continue;
      this.restoreAttribute(child,'disabled',authored.disabled); this.restoreAttribute(child,'tabindex',authored.tab);
      child.setAttribute('aria-disabled',String(authored.disabled !== null)); this.disabledChildren.delete(child);
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
dialog[data-af-dialog-native]{margin:auto;max-height:calc(100svh - 4rem);width:fit-content;max-width:min(32rem,calc(100vw - 2rem));overflow:auto;border-radius:var(--radius-lg,var(--radius,.625rem));border:1px solid var(--border);background:var(--background);padding:1.5rem;color:var(--foreground);box-shadow:var(--shadow-lg,0 10px 15px -3px rgb(0 0 0 / 10%),0 4px 6px -4px rgb(0 0 0 / 10%))}
af-dialog-content{display:flex;flex-direction:column;gap:1rem}
af-dialog-content h2{font-family:var(--font-display,inherit);font-weight:600}
af-dialog-content p:not([class]){line-height:1.65;margin:.75rem 0}
af-dialog-content h2:not([class]){font-size:1.75rem;font-weight:600;line-height:1.2;margin-block:1.6em .5em;text-wrap:balance}
@media(max-width:639px){af-dialog-content h2:not([class]){font-size:1.5rem}}
af-dialog-header{display:flex;flex-direction:column;gap:.5rem}
af-dialog-footer{display:flex;justify-content:flex-end;gap:.5rem}
af-dialog-title{display:block;font-family:var(--font-display,inherit);font-size:1.125rem;font-weight:600;line-height:1}
af-dialog-description{display:block;color:var(--muted-foreground);font-size:.875rem}
af-dialog-trigger,af-dialog-close{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:.5rem 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;background:var(--primary);color:var(--primary-foreground)}
af-dialog-trigger:has(button,input,select,textarea,a[href]),af-dialog-close:has(button,input,select,textarea,a[href]){display:contents}
af-dialog-trigger>button{box-sizing:border-box;display:inline-flex;height:2.25rem;align-items:center;justify-content:center;gap:.5rem;border:0;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:.5rem 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;background:var(--primary);color:var(--primary-foreground)}
af-dialog-trigger:not([disabled]):hover,af-dialog-trigger:not([disabled])>button:not(:disabled):not([aria-disabled="true"]):hover{background:color-mix(in oklab,var(--primary,#171717) 90%,transparent)}
af-dialog-close{border:1px solid currentColor;background:var(--background);color:var(--foreground);box-shadow:var(--shadow-xs,0 1px 2px 0 rgb(0 0 0 / 0.05))}
af-dialog-close>button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border:1px solid currentColor;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));padding:.5rem 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer;background:var(--background);color:var(--foreground);box-shadow:var(--shadow-xs,0 1px 2px 0 rgb(0 0 0 / 0.05))}
:root[data-af-dark="true"] af-dialog-close,:root[data-af-dark="true"] af-dialog-close>button{border-color:var(--input);background:color-mix(in oklab,var(--input) 30%,transparent)}
af-dialog-trigger:focus-visible,af-dialog-close:focus-visible,af-dialog-trigger>button:focus-visible,af-dialog-close>button:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}
af-dialog-trigger[disabled],af-dialog-close[disabled]{opacity:.5;cursor:default}
af-dialog-trigger[disabled]>button,af-dialog-trigger>button:disabled,af-dialog-trigger>button[aria-disabled="true"]{opacity:.5;cursor:default}
af-dialog-close[disabled]>button,af-dialog-close>button:disabled,af-dialog-close>button[aria-disabled="true"]{opacity:.5;cursor:default}
`;
/** Registration descriptor (tags + stylesheet) applied on import; exported for tests. */
export const dialogComponent: ComponentDescriptor = {
  styleKey: 'af-dialog-styles',
  styles: dialogStyles,
  elements: {
    'af-dialog': AfDialog,
    'af-dialog-trigger': AfDialogTrigger,
    'af-dialog-content': AfDialogContent,
    'af-dialog-header': AfDialogHeader,
    'af-dialog-footer': AfDialogFooter,
    'af-dialog-title': AfDialogTitle,
    'af-dialog-description': AfDialogDescription,
    'af-dialog-close': AfDialogClose,
  },
};
registerComponent(dialogComponent);
