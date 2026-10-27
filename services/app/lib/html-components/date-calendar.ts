/** Internal helper for af-date-picker; not a public entry point. */
export interface CalendarMonth { year: number; month: number }
export interface CalendarDay { value: string; day: number; inMonth: boolean }
export interface DateBounds { min?: string | null; max?: string | null }
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split('-').map(Number);
  return y! >= 1 && m! >= 1 && m! <= 12 && d! >= 1 && d! <= daysInMonth(y!, m!);
}
function daysInMonth(year: number, month: number): number {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,31,30,31,30,31,31,30,31,30,31][month - 1] ?? 0;
}
export function localToday(clock: () => Date = () => new Date()): string {
  const date = clock(); return formatDate(date.getFullYear(), date.getMonth()+1, date.getDate());
}
function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
export function moveMonth(view: CalendarMonth, delta: number): CalendarMonth {
  const n = Math.max(12, Math.min(9999 * 12 + 11, view.year * 12 + view.month - 1 + delta));
  return { year: Math.floor(n / 12), month: n % 12 + 1 };
}
export function inBounds(value: string, bounds: DateBounds): boolean {
  return validDate(value) && (!validDate(bounds.min) || value >= bounds.min) && (!validDate(bounds.max) || value <= bounds.max);
}
export function monthGrid(view: CalendarMonth): CalendarDay[] {
  const date = new Date(0); date.setFullYear(view.year, view.month-1, 1); date.setHours(12,0,0,0);
  const offset = date.getDay();
  const count = Math.ceil((offset + daysInMonth(view.year,view.month))/7)*7;
  return Array.from({length: count}, (_,i) => {
    const d = new Date(date); d.setDate(1-offset+i);
    return { value: formatDate(d.getFullYear(),d.getMonth()+1,d.getDate()), day:d.getDate(), inMonth:d.getMonth()===view.month-1 };
  });
}
