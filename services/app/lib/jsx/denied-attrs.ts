import { immutableSet } from '@/lib/utils/immutable-collections';

/** Shared save/render gate. Iframe payload HTML has its own isolated compiler. */
export const DENIED_JSX_ATTRS = immutableSet([
  'dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is',
  // Native top-layer activation can paint above trusted controls without JS.
  'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor',
]);
