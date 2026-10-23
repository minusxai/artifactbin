/** Deliberately bounded legacy SQL update, evaluated against one viewer snapshot. */
export interface LegacyScalarOperation {
  target: string;
  source: string;
  operator: '+' | '-';
  operand: number;
}
