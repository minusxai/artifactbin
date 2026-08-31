/**
 * The body↔source path translation annotations ride on (the Helmet-offset
 * lesson): the served document renders the BODY (Helmet hoisted out), the
 * source counts from the top, and only the FIRST index differs. The anchor
 * itself is the node's `data-annotation-anchor` attribute — a lookup, not span algebra —
 * so this is the one pure coordinate seam left to hold.
 */
import { describe, expect, it } from 'vitest';
import { sourcePathToBodyPath } from '@/lib/story/edit-compose';

const PLAIN = '<div>hello</div><p>world</p>';
const WITH_HELMET = '<Helmet><title>t</title></Helmet><div>hello</div><p>world</p>';

describe('sourcePathToBodyPath', () => {
  it('subtracts the Helmet offset from the first index only', () => {
    expect(sourcePathToBodyPath(WITH_HELMET, '1')).toBe('0');
    expect(sourcePathToBodyPath(WITH_HELMET, '2.0')).toBe('1.0');
  });

  it('is the identity without a Helmet', () => {
    expect(sourcePathToBodyPath(PLAIN, '1.0')).toBe('1.0');
  });

  it('null for the Helmet itself — it has no body address', () => {
    expect(sourcePathToBodyPath(WITH_HELMET, '0')).toBeNull();
    expect(sourcePathToBodyPath(WITH_HELMET, '0.0')).toBeNull();
  });
});
