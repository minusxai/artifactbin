/** Finite scalar SQL parameters shared by dataset HTTP read and write doors. */
import type { Scalar } from '@/lib/dataflow';
import { Reply, reply } from './http';

export function parseScalarValues(value: unknown): Record<string, Scalar> | Reply {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return reply({ error: 'invalid_values', details: ['values must be an object of scalars'] }, 400);
  }
  for (const [key, scalar] of Object.entries(value)) {
    if (!(scalar === null || typeof scalar === 'string' || typeof scalar === 'boolean' || (typeof scalar === 'number' && Number.isFinite(scalar)))) {
      return reply({ error: 'invalid_values', details: [`value "${key}" must be a string, number, boolean or null`] }, 400);
    }
  }
  return value as Record<string, Scalar>;
}
