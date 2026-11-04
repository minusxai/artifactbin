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

/**
 * A monotone pairing of two sequences (indices only ever increase on both sides) maximising the summed `score`;
 * `-Infinity` forbids a pair. Pairs are returned in order.
 */
export function alignPairs(m: number, n: number, score: (i: number, j: number) => number): [number, number][] {
  const best = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const pair = score(i, j);
      best[i]![j] = Math.max(best[i + 1]![j]!, best[i]![j + 1]!, pair === -Infinity ? -Infinity : pair + best[i + 1]![j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < m && j < n;) {
    const pair = score(i, j);
    if (pair !== -Infinity && best[i]![j] === pair + best[i + 1]![j + 1]! && pair > 0) { pairs.push([i, j]); i++; j++; }
    else if (best[i]![j] === best[i + 1]![j]) i++;
    else j++;
  }
  return pairs;
}

/** How alike two texts are, word by word (Dice coefficient over lowercased words; two empty texts are alike). */
export function similarity(a: string, b: string): number {
  const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const left = words(a), right = words(b);
  if (!left.length && !right.length) return a.trim() === b.trim() ? 1 : 0;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) { const count = counts.get(word) ?? 0; if (count) { shared++; counts.set(word, count - 1); } }
  return (2 * shared) / (left.length + right.length);
}
