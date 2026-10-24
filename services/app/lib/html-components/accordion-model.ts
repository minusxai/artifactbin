export type AccordionType = 'single' | 'multiple';
export type AccordionValue = string | string[];

export interface AccordionChangeDetail { value: AccordionValue }
export interface AccordionContract { value: AccordionValue }

export function normalizeAccordionValue(type: AccordionType, value: AccordionValue): AccordionValue {
  if (type === 'single') return Array.isArray(value) ? value[0] ?? '' : value;
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.filter(Boolean))];
}

export function toggleAccordionValue(type: AccordionType, current: AccordionValue, next: string, collapsible: boolean): AccordionValue {
  const value = normalizeAccordionValue(type,current);
  if (type === 'single') return value === next ? (collapsible ? '' : value) : next;
  const values = value as string[];
  return values.includes(next) ? values.filter(item => item !== next) : [...values,next];
}

export function equalAccordionValue(type: AccordionType, left: AccordionValue, right: AccordionValue): boolean {
  const a = normalizeAccordionValue(type,left); const b = normalizeAccordionValue(type,right);
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((value,index) => value === b[index]) : a === b;
}
