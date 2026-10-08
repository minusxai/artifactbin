import { immutableSet } from '@/lib/jsx/immutable-set';

/** Shared save/render gate. */
export const DENIED_JSX_ATTRS = immutableSet([
  'dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is',
  // Native top-layer activation can paint above trusted controls without JS.
  'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor',
]);
