import { inBounds, localToday, monthGrid, moveMonth, validDate, type CalendarMonth } from './date-calendar';
export interface AfDatePickerChangeDetail { value: string | null }
/** Author-owned controlled value, or viewer-local default; never persists data. */
export class AfDatePicker extends HTMLElement {
  static observedAttributes = ['value','label','aria-label','min','max','disabled','readonly','read-only'];
  private controlled = false;
  private propertyValue: string | null = null;
  private state: string | null = null;
  private initialized = false;
  private trigger?: HTMLButtonElement;
  private popup?: HTMLDivElement;
  private view: CalendarMonth = {year:2024,month:1};
  private open = false;
  get value(): string | null { const v=this.controlled ? this.propertyValue : this.hasAttribute('value') ? this.getAttribute('value') : this.state; return validDate(v) ? v : null; }
  set value(value: string | null) { this.controlled=true; this.propertyValue=validDate(value)?value:null; this.render(); }
  get disabled(): boolean { return this.hasAttribute('disabled'); }
  set disabled(value: boolean) { this.toggleAttribute('disabled',value); }
  private get locked(): boolean { return this.disabled || this.hasAttribute('readonly') || this.hasAttribute('read-only'); }
  connectedCallback(): void {
    if(Object.prototype.hasOwnProperty.call(this,'value')) { const v=this.value; delete (this as unknown as {value?:string|null}).value; this.value=v; }
    if(!this.initialized) { const v=this.getAttribute('default-value'); this.state=validDate(v)?v:null; this.initialized=true; }
    if(!this.trigger) {
      this.trigger=this.ownerDocument.createElement('button'); this.trigger.type='button'; this.trigger.className='af-date-trigger';
      this.trigger.setAttribute('aria-haspopup','dialog'); this.trigger.addEventListener('click',()=>this.toggle());
      this.popup=this.ownerDocument.createElement('div'); this.popup.className='af-date-popup'; this.popup.setAttribute('role','dialog');
      this.prepend(this.trigger,this.popup); this.addEventListener('keydown',this.keydown);
      this.addEventListener('focusout',event=>{ if(event.relatedTarget instanceof Node && !this.contains(event.relatedTarget)) this.close(false); });
    }
    this.ownerDocument.addEventListener('pointerdown',this.outside); this.render();
  }
  disconnectedCallback(): void { this.ownerDocument.removeEventListener('pointerdown',this.outside); this.open=false; }
  attributeChangedCallback(): void { if(this.locked) this.open=false; this.render(); }
  private outside = (event: Event): void => { if(!event.composedPath().includes(this)) this.close(false); };
  private close(focus=true): void { this.open=false; this.render(); if(focus) this.trigger?.focus(); }
  private toggle(): void {
    if(this.locked) return;
    if(this.open) { this.close(); return; }
    const value=this.value ?? localToday(); this.view={year:Number(value.slice(0,4)),month:Number(value.slice(5,7))}; this.open=true; this.render();
    (this.popup?.querySelector<HTMLButtonElement>('[aria-pressed=true]:not(:disabled)') ?? this.popup?.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)'))?.focus();
  }
  private choose(value:string|null): void {
    if(this.locked || (value!==null && !inBounds(value,{min:this.getAttribute('min'),max:this.getAttribute('max')}))) return;
    const accepted=this.dispatchEvent(new CustomEvent<AfDatePickerChangeDetail>('af-change',{detail:{value},bubbles:true,composed:true,cancelable:true}));
    if(accepted && !this.controlled && !this.hasAttribute('value')) this.state=value;
    this.close();
  }
  private keydown = (event: KeyboardEvent): void => {
    if(event.key==='Escape' && this.open) { event.preventDefault(); this.close(); return; }
    if(!this.open) { if(event.key==='ArrowDown' && !this.locked) { event.preventDefault(); this.toggle(); } return; }
    const target=event.target as HTMLElement;
    if(event.key==='PageUp'||event.key==='PageDown') { event.preventDefault(); this.view=moveMonth(this.view,(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1)); this.render(); this.popup?.querySelector<HTMLButtonElement>('[data-date]:not(:disabled)')?.focus(); return; }
    const delta=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];
    if(delta!==undefined && target.dataset.date) {
      event.preventDefault(); const date=new Date(`${target.dataset.date}T12:00:00`); date.setDate(date.getDate()+delta);
      const next=localToday(()=>date); if(!inBounds(next,{min:this.getAttribute('min'),max:this.getAttribute('max')})) return;
      this.view={year:date.getFullYear(),month:date.getMonth()+1}; this.render(); this.popup?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)?.focus();
    }
  };
  private render(): void {
    if(!this.trigger || !this.popup) return;
    const label=this.getAttribute('aria-label') || this.getAttribute('label') || 'Date';
    this.trigger.textContent=this.value ?? this.getAttribute('placeholder') ?? 'Pick a date'; this.trigger.setAttribute('aria-label',`${label}: ${this.value ?? 'Pick a date'}`);
    this.trigger.disabled=this.disabled; this.trigger.setAttribute('aria-readonly',String(this.locked)); this.trigger.setAttribute('aria-expanded',String(this.open));
    this.popup.hidden=!this.open; this.popup.setAttribute('aria-label',`${label} calendar`); if(!this.open) return;
    this.popup.replaceChildren();
    const button=(text:string,name:string,action:()=>void):HTMLButtonElement=>{const b=this.ownerDocument.createElement('button'); b.type='button'; b.textContent=text; b.setAttribute('aria-label',name); b.addEventListener('click',action); return b;};
    const header=this.ownerDocument.createElement('div'); header.className='af-date-header';
    const title=this.ownerDocument.createElement('span'); const d=new Date(0); d.setFullYear(this.view.year,this.view.month-1,1);
    title.textContent=new Intl.DateTimeFormat('en',{month:'long',year:'numeric'}).format(d); title.setAttribute('aria-live','polite');
    const nav=(delta:number)=>{this.view=moveMonth(this.view,delta);this.render(); this.popup?.querySelector<HTMLButtonElement>(`[aria-label="${delta===-12?'Previous year':delta===-1?'Previous month':delta===1?'Next month':'Next year'}"]`)?.focus();};
    header.append(button('«','Previous year',()=>nav(-12)),button('‹','Previous month',()=>nav(-1)),title,button('›','Next month',()=>nav(1)),button('»','Next year',()=>nav(12))); this.popup.append(header);
    const grid=this.ownerDocument.createElement('div'); grid.className='af-date-grid';
    for(const day of ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']) { const el=this.ownerDocument.createElement('abbr'); el.textContent=day.slice(0,2); el.setAttribute('aria-label',day); grid.append(el); }
    const today=localToday();
    for(const cell of monthGrid(this.view)) { const b=button(String(cell.day),cell.value,()=>this.choose(cell.value)); b.dataset.date=cell.value; b.dataset.adjacent=String(!cell.inMonth); b.setAttribute('aria-pressed',String(cell.value===this.value)); if(cell.value===today)b.setAttribute('aria-current','date'); b.disabled=!inBounds(cell.value,{min:this.getAttribute('min'),max:this.getAttribute('max')}); grid.append(b); }
    this.popup.append(grid); const todayButton=button('Today','Today',()=>this.choose(today)); todayButton.disabled=!inBounds(today,{min:this.getAttribute('min'),max:this.getAttribute('max')}); this.popup.append(todayButton,button('Clear','Clear date',()=>this.choose(null)));
  }
}
const styles=`af-date-picker{display:inline-block;position:relative;color:var(--foreground,#222);font:inherit}af-date-picker button{font:inherit;color:inherit;background:var(--background,#fff);border:1px solid var(--border,#ddd);border-radius:var(--radius,.375rem);padding:.375rem;cursor:pointer}af-date-picker button:disabled{opacity:.4;cursor:not-allowed}af-date-picker button:focus-visible{outline:2px solid var(--ring,#777);outline-offset:2px}af-date-picker .af-date-popup{position:absolute;top:100%;left:0;z-index:50;width:18rem;padding:.75rem;background:var(--popover,var(--background,#fff));color:var(--popover-foreground,var(--foreground,#222));border:1px solid var(--border,#ddd);border-radius:var(--radius,.375rem);box-shadow:0 4px 16px #0002}af-date-picker .af-date-popup[hidden]{display:none}af-date-picker .af-date-header{display:flex;align-items:center;justify-content:space-between;gap:.25rem}af-date-picker .af-date-grid{display:grid;grid-template-columns:repeat(7,1fr);margin:.5rem 0;gap:.125rem;text-align:center}af-date-picker .af-date-grid button{border:0}af-date-picker [data-adjacent=true]{color:var(--muted-foreground,#777)}af-date-picker [aria-pressed=true]{background:var(--primary,#222);color:var(--primary-foreground,#fff)}af-date-picker abbr{text-decoration:none;font-size:.75rem}`;
export function registerDatePicker(registry:CustomElementRegistry=customElements,document:Document=globalThis.document):void {
 if(!document.querySelector('style[data-af-date-picker-styles]')) { const style=document.createElement('style'); style.setAttribute('data-af-date-picker-styles',''); style.textContent=styles; document.head.append(style); }
 if(!registry.get('af-date-picker'))registry.define('af-date-picker',AfDatePicker);
}
