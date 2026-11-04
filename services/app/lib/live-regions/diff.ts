/**
 * Myers' O(ND) difference of two sequences, as the hunks that differ: `a[aStart, aEnd)` becomes `b[bStart, bEnd)`.
 * Edits beyond `limit` fall back to one hunk over the trimmed middle (a rewrite that large has no useful alignment).
 */
export interface Hunk { aStart: number; aEnd: number; bStart: number; bEnd: number }

export function diffHunks<T>(a: ArrayLike<T>, b: ArrayLike<T>, equal: (x: T, y: T) => boolean = Object.is, limit = 4000): Hunk[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && equal(a[prefix]!, b[prefix]!)) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && equal(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)) suffix++;
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
  if (!n && !m) return [];
  if (!n || !m) return [{ aStart: prefix, aEnd: prefix + n, bStart: prefix, bEnd: prefix + m }];
  const max = Math.min(n + m, limit);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && equal(a[prefix + x]!, b[prefix + y]!)) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return [{ aStart: prefix, aEnd: prefix + n, bStart: prefix, bEnd: prefix + m }];
  // Walk back: each step is one deletion or insertion between diagonals.
  const edits: { x: number; y: number; kind: 'delete' | 'insert' }[] = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const previous = trace[d]!;
    const k = x - y;
    const down = k === -d || (k !== d && previous[offset + k - 1]! < previous[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = previous[offset + prevK]!, prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; }
    if (down) edits.push({ x: prevX, y: prevY, kind: 'insert' });
    else edits.push({ x: prevX, y: prevY, kind: 'delete' });
    x = prevX; y = prevY;
  }
  edits.reverse();
  const hunks: Hunk[] = [];
  for (const edit of edits) {
    const last = hunks.at(-1);
    const aEnd = edit.x + (edit.kind === 'delete' ? 1 : 0), bEnd = edit.y + (edit.kind === 'insert' ? 1 : 0);
    if (last && last.aEnd === prefix + edit.x && last.bEnd === prefix + edit.y) { last.aEnd = prefix + aEnd; last.bEnd = prefix + bEnd; }
    else hunks.push({ aStart: prefix + edit.x, aEnd: prefix + aEnd, bStart: prefix + edit.y, bEnd: prefix + bEnd });
  }
  return hunks;
}
