/**
 * Internal: date math, keyboard targets, the trigger icon and styles for af-date-picker.
 * Used by: date-picker.ts.
 */
export interface CalendarMonth { year: number; month: number }
export interface CalendarDay { value: string; day: number; inMonth: boolean }
export interface DateBounds { min?: string | null; max?: string | null }
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  return y! >= 1 && m! >= 1 && m! <= 12 && d! >= 1 && d! <= daysInMonth(y!, m!);
}
function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month - 1] ?? 0;
}
export function localToday(clock: () => Date = () => new Date()): string {
  const date = clock(); return formatDate(date.getFullYear(), date.getMonth()+1, date.getDate());
}
function formatDate(year: number, month: number, day: number): string {
  const pad = (n: number, width: number) => String(n).padStart(width,'0');
  return `${pad(year,4)}-${pad(month,2)}-${pad(day,2)}`;
}
export function moveMonth(view: CalendarMonth, delta: number): CalendarMonth {
  const n = Math.max(12, Math.min(9999 * 12 + 11, view.year * 12 + view.month - 1 + delta));
  return { year: Math.floor(n / 12), month: n % 12 + 1 };
}
export function inBounds(value: string, bounds: DateBounds): boolean {
  return validDate(value) && (!validDate(bounds.min) || value >= bounds.min) &&
    (!validDate(bounds.max) || value <= bounds.max);
}
export function monthGrid(view: CalendarMonth): CalendarDay[] {
  const date = new Date(0); date.setFullYear(view.year, view.month-1, 1); date.setHours(12,0,0,0);
  const offset = date.getDay();
  const count = Math.ceil((offset + daysInMonth(view.year,view.month))/7)*7;
  return Array.from({length: count}, (_,i) => {
    const d = new Date(date); d.setDate(1-offset+i);
    return { value: formatDate(d.getFullYear(),d.getMonth()+1,d.getDate()), day:d.getDate(),
      inMonth: d.getMonth()===view.month-1 };
  });
}
/** Clamp a valid date into bounds; anything else passes through unchanged. */
export function clampDate(value: string, bounds: DateBounds): string {
  if (!validDate(value)) return value;
  if (validDate(bounds.min) && value<bounds.min) return bounds.min;
  if (validDate(bounds.max) && value>bounds.max) return bounds.max;
  return value;
}
/** The same day of the month in `view`, capped at that month's last day. */
export function sameDay(view: CalendarMonth, day: number): string | undefined {
  const dates = monthGrid(view).filter(cell=>cell.inMonth);
  return dates[Math.min(day,dates.length)-1]?.value;
}
/**
 * Where a grid key moves focus from `date`: PageUp/PageDown by month (Shift: year), arrows by
 * day/week (mirrored in RTL), Home/End to the week edges. Undefined for other keys.
 */
export function keyTarget(date: string, event: KeyboardEvent, rtl: () => boolean):
  string | undefined {
  const current = new Date(`${date}T12:00:00`);
  if (event.key === 'PageUp' || event.key === 'PageDown') {
    const step = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
    return sameDay(moveMonth({year:current.getFullYear(),month:current.getMonth()+1}, step),
      current.getDate());
  }
  const flip = event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? rtl() : false;
  const delta = ({ArrowLeft:flip?1:-1,ArrowRight:flip?-1:1,ArrowUp:-7,ArrowDown:7,
    Home:-current.getDay(),End:6-current.getDay()} as Record<string,number>)[event.key];
  if (delta === undefined) return undefined;
  current.setDate(current.getDate()+delta); return localToday(()=>current);
}
const SVG = 'http://www.w3.org/2000/svg';
/** Decorative calendar glyph for the trigger (hidden from assistive tech). */
export function calendarIcon(doc: Document): SVGSVGElement {
  const node = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string,string>) => {
    const el = doc.createElementNS(SVG, tag);
    for (const [name,value] of Object.entries(attrs)) el.setAttribute(name,value);
    return el;
  };
  const icon = node('svg', {xmlns:SVG,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',
    'stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',
    focusable:'false'});
  icon.classList.add('af-date-icon');
  icon.append(node('path',{d:'M8 2v4'}), node('path',{d:'M16 2v4'}),
    node('rect',{width:'18',height:'18',x:'3',y:'4',rx:'2'}), node('path',{d:'M3 10h18'}));
  return icon;
}
/** A calendar button; day cells, arrows and footer actions all share this shape. */
export function dateButton(doc: Document, text: string, name: string, action: () => void,
  className = ''): HTMLButtonElement {
  const b=doc.createElement('button'); b.type='button'; b.textContent=text;
  b.setAttribute('aria-label',name); if(className)b.className=className;
  b.addEventListener('click',action); return b;
}
/** The day grid, seeded with one-letter weekday headings (full name as aria-label). */
export function weekdayGrid(doc: Document): HTMLDivElement {
  const grid=doc.createElement('div'); grid.className='af-date-grid';
  for(const day of ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']) {
    const el=doc.createElement('abbr'); el.textContent=day.slice(0,1);
    el.setAttribute('aria-label',day); grid.append(el);
  }
  return grid;
}
/** Roving-tabindex day: keep `focused` if selectable, else the value, first in month, first. */
export function focusTarget(selectable: CalendarDay[], focused: string | null,
  value: string | null): string | null {
  if(selectable.some(cell=>cell.value===focused)) return focused;
  return selectable.find(cell=>cell.value===value)?.value ??
    selectable.find(cell=>cell.inMonth)?.value ?? selectable[0]?.value ?? null;
}
/** Live month heading, e.g. "March 2026", for the popup header. */
export function monthTitle(doc: Document, view: CalendarMonth): HTMLSpanElement {
  const title=doc.createElement('span'); const d=new Date(0);
  d.setFullYear(view.year,view.month-1,1);
  title.textContent=new Intl.DateTimeFormat('en',{month:'long',year:'numeric'}).format(d);
  title.setAttribute('aria-live','polite'); return title;
}
export interface CalendarState { view: CalendarMonth; focused: string | null; value: string | null;
  today: string; bounds: DateBounds; years: boolean; clear: boolean }
export interface CalendarActions { choose(value: string | null): void; focus(value: string): void;
  nav(delta: number, name: string): void }
/**
 * Fill the open popup: header (month arrows, optional year arrows), day grid with a roving
 * tabindex, and a Today/Clear footer. Returns the day that owns tabindex 0.
 */
export function calendarBody(doc: Document, popup: HTMLElement, s: CalendarState,
  a: CalendarActions): string | null {
  const nav=(text: string, name: string, delta: number) =>
    dateButton(doc,text,name,()=>a.nav(delta,name),'af-date-nav');
  const header=doc.createElement('div'); header.className='af-date-header';
  if(s.years) header.append(nav('«','Previous year',-12));
  const monthNavigation=doc.createElement('div'); monthNavigation.className='af-date-navigation';
  monthNavigation.append(nav('‹','Previous month',-1),nav('›','Next month',1));
  header.append(monthTitle(doc,s.view),monthNavigation);
  if(s.years) header.append(nav('»','Next year',12));
  const grid=weekdayGrid(doc); popup.append(header,grid);
  const cells=monthGrid(s.view);
  const focused=focusTarget(cells.filter(cell=>inBounds(cell.value,s.bounds)),s.focused,s.value);
  for(const cell of cells) {
    const b=dateButton(doc,String(cell.day),cell.value,()=>a.choose(cell.value));
    b.dataset.date=cell.value; b.tabIndex=cell.value===focused?0:-1;
    b.addEventListener('focus',()=>{ a.focus(cell.value);
      for(const day of popup.querySelectorAll<HTMLButtonElement>('[data-date]')) {
        day.tabIndex=day===b?0:-1;
      } });
    b.dataset.adjacent=String(!cell.inMonth);
    b.setAttribute('aria-pressed',String(cell.value===s.value));
    if(cell.value===s.today)b.setAttribute('aria-current','date');
    b.disabled=!inBounds(cell.value,s.bounds); grid.append(b);
  }
  const showToday=inBounds(s.today,s.bounds);
  if(showToday || s.clear) {
    const footer=doc.createElement('div'); footer.className='af-date-footer';
    if(showToday) footer.append(dateButton(doc,'Today','Today',()=>a.choose(s.today),
      'af-date-today'));
    if(s.clear) footer.append(dateButton(doc,'Clear','Clear date',()=>a.choose(null),
      'af-date-clear'));
    popup.append(footer);
  }
  return focused;
}
