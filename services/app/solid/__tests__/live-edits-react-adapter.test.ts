/**
 * THE UNMODIFIED React suite for lib/story/use-live-edits, run against the React adapter over the
 * framework-free core instead of the hook: the module is swapped, the suite's own file is imported
 * as-is (its describe/it blocks register here). Same 28 cases, same assertions, zero copied lines.
 */
import { vi } from 'vitest';

vi.mock('@/lib/story/use-live-edits', () => import('@/solid/shared/use-live-edits-react'));

await import('@/lib/story/__tests__/use-live-edits.ui.test');
