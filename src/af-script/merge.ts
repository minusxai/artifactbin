/**
 * Line-based diff, three-way merge and unified diff for publish.mjs. Pure.
 * The diff is patience-anchored (lines unique on both sides) with an exact
 * LCS between anchors, so typical page edits diff exactly and large files
 * stay fast.
 */
import type { ConflictRegion } from "./lifecycle-contracts.ts";

/** Lines with their line endings, so joining them gives the text back. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** A changed span: base lines [oStart, oEnd) became other lines [xStart, xEnd). */
export interface Hunk {
  oStart: number;
  oEnd: number;
  xStart: number;
  xEnd: number;
}

/** Cells of the LCS table above which a region without anchors counts as replaced whole. */
const MAX_TABLE = 4_000_000;

function lcs(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, out: [number, number][]): void {
  // Common prefix and suffix first: most edits are local.
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) out.push([aLo++, bLo++]);
  const tail: [number, number][] = [];
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) tail.push([--aHi, --bHi]);
  if (aLo < aHi && bLo < bHi) {
    const anchors = uniqueAnchors(a, aLo, aHi, b, bLo, bHi);
    if (anchors.length) {
      let ai = aLo,
        bi = bLo;
      for (const [x, y] of anchors) {
        lcs(a, ai, x, b, bi, y, out);
        out.push([x, y]);
        ai = x + 1;
        bi = y + 1;
      }
      lcs(a, ai, aHi, b, bi, bHi, out);
    } else table(a, aLo, aHi, b, bLo, bHi, out);
  }
  for (let index = tail.length - 1; index >= 0; index--) out.push(tail[index]!);
}

/** Lines that occur exactly once on each side, in the longest order-preserving chain. */
function uniqueAnchors(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number): [number, number][] {
  const counts = new Map<number, { a: number; b: number; ai: number; bi: number }>();
  for (let i = aLo; i < aHi; i++) {
    const entry = counts.get(a[i]!) ?? { a: 0, b: 0, ai: -1, bi: -1 };
    entry.a++;
    entry.ai = i;
    counts.set(a[i]!, entry);
  }
  for (let j = bLo; j < bHi; j++) {
    const entry = counts.get(b[j]!);
    if (!entry) continue;
    entry.b++;
    entry.bi = j;
  }
  const pairs: [number, number][] = [];
  for (const entry of counts.values()) if (entry.a === 1 && entry.b === 1) pairs.push([entry.ai, entry.bi]);
  pairs.sort((x, y) => x[0] - y[0]);
  // Longest increasing subsequence on the b index.
  const tails: number[] = [];
  const previous = new Array<number>(pairs.length).fill(-1);
  for (let index = 0; index < pairs.length; index++) {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < pairs[index]![1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[index] = tails[lo - 1]!;
    tails[lo] = index;
  }
  const chain: [number, number][] = [];
  for (let index = tails.length ? tails[tails.length - 1]! : -1; index >= 0; index = previous[index]!) chain.push(pairs[index]!);
  return chain.reverse();
}

function table(a: Int32Array, aLo: number, aHi: number, b: Int32Array, bLo: number, bHi: number, out: [number, number][]): void {
  const n = aHi - aLo,
    m = bHi - bLo;
  if ((n + 1) * (m + 1) > MAX_TABLE) return;
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lengths[i * width + j] =
        a[aLo + i] === b[bLo + j]
          ? lengths[(i + 1) * width + j + 1]! + 1
          : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[aLo + i] === b[bLo + j]) out.push([aLo + i++, bLo + j++]);
    else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++;
    else j++;
  }
}

/** The changes that turn `base` lines into `other` lines. */
export function diffLines(base: readonly string[], other: readonly string[]): Hunk[] {
  const ids = new Map<string, number>();
  const intern = (lines: readonly string[]) =>
    Int32Array.from(lines, (line) => {
      let id = ids.get(line);
      if (id === undefined) ids.set(line, (id = ids.size));
      return id;
    });
  const a = intern(base),
    b = intern(other);
  const matches: [number, number][] = [];
  lcs(a, 0, a.length, b, 0, b.length, matches);
  const hunks: Hunk[] = [];
  let i = 0,
    j = 0;
  for (const [x, y] of [...matches, [a.length, b.length] as [number, number]]) {
    if (x > i || y > j) hunks.push({ oStart: i, oEnd: x, xStart: j, xEnd: y });
    i = x + 1;
    j = y + 1;
  }
  return hunks;
}

export interface MergeResult {
  clean: boolean;
  /** The merged text; meaningful only when clean. */
  text: string;
  conflicts: ConflictRegion[];
}

interface SideHunk extends Hunk {
  side: "ours" | "theirs";
}

/**
 * Three-way merge by lines. A region changed on one side takes that side; a
 * region changed identically on both takes it once; anything else conflicts,
 * including two insertions at the same point.
 */
export function merge3(base: string, ours: string, theirs: string): MergeResult {
  const o = splitLines(base),
    a = splitLines(ours),
    b = splitLines(theirs);
  const hunks: SideHunk[] = [
    ...diffLines(o, a).map((hunk) => ({ ...hunk, side: "ours" as const })),
    ...diffLines(o, b).map((hunk) => ({ ...hunk, side: "theirs" as const })),
  ].sort((x, y) => x.oStart - y.oStart || x.oEnd - y.oEnd);
  const regions: { oStart: number; oEnd: number; hunks: SideHunk[] }[] = [];
  for (const hunk of hunks) {
    const current = regions.at(-1);
    const last = current?.hunks.at(-1);
    const touches =
      current &&
      (hunk.oStart < current.oEnd ||
        (hunk.oStart === current.oEnd && (hunk.oStart === hunk.oEnd || (last!.oStart === last!.oEnd && last!.oStart === current.oEnd))));
    if (current && touches) {
      current.oEnd = Math.max(current.oEnd, hunk.oEnd);
      current.hunks.push(hunk);
    } else regions.push({ oStart: hunk.oStart, oEnd: hunk.oEnd, hunks: [hunk] });
  }
  const span = (lines: string[], side: SideHunk[], start: number, end: number): [number, number] => {
    if (!side.length) return [start, end];
    const first = side[0]!,
      last = side.at(-1)!;
    return [first.xStart - (first.oStart - start), last.xEnd + (end - last.oEnd)];
  };
  const output: string[] = [];
  const conflicts: ConflictRegion[] = [];
  let position = 0;
  for (const region of regions) {
    output.push(...o.slice(position, region.oStart));
    position = region.oEnd;
    const mine = region.hunks.filter((hunk) => hunk.side === "ours");
    const others = region.hunks.filter((hunk) => hunk.side === "theirs");
    const [as, ae] = span(a, mine, region.oStart, region.oEnd);
    const [bs, be] = span(b, others, region.oStart, region.oEnd);
    const left = mine.length ? a.slice(as, ae) : o.slice(region.oStart, region.oEnd);
    const right = others.length ? b.slice(bs, be) : o.slice(region.oStart, region.oEnd);
    if (!mine.length) output.push(...right);
    else if (!others.length || left.join("") === right.join("")) output.push(...left);
    else {
      conflicts.push({
        base: [region.oStart + 1, region.oEnd],
        local: [as + 1, ae],
        remote: [bs + 1, be],
      });
      output.push(...left);
    }
  }
  output.push(...o.slice(position));
  return { clean: !conflicts.length, text: output.join(""), conflicts };
}

/** A unified diff from `before` to `after`, with `context` lines around each change. */
export function unifiedDiff(before: string, after: string, beforeName: string, afterName: string, context = 3): string {
  const a = splitLines(before),
    b = splitLines(after);
  const hunks = diffLines(a, b);
  if (!hunks.length) return "";
  const groups: Hunk[][] = [];
  for (const hunk of hunks) {
    const group = groups.at(-1);
    if (group && hunk.oStart - group.at(-1)!.oEnd <= 2 * context) group.push(hunk);
    else groups.push([hunk]);
  }
  const line = (prefix: string, text: string) => prefix + text + (text.endsWith("\n") ? "" : "\n\\ No newline at end of file\n");
  let output = `--- ${beforeName}\n+++ ${afterName}\n`;
  for (const group of groups) {
    const first = group[0]!,
      last = group.at(-1)!;
    const oStart = Math.max(0, first.oStart - context);
    const oEnd = Math.min(a.length, last.oEnd + context);
    const xStart = first.xStart - (first.oStart - oStart);
    const xEnd = last.xEnd + (oEnd - last.oEnd);
    const range = (start: number, length: number) => (length === 1 ? `${start + 1}` : `${length ? start + 1 : start},${length}`);
    output += `@@ -${range(oStart, oEnd - oStart)} +${range(xStart, xEnd - xStart)} @@\n`;
    let position = oStart;
    for (const hunk of group) {
      for (; position < hunk.oStart; position++) output += line(" ", a[position]!);
      for (let index = hunk.oStart; index < hunk.oEnd; index++) output += line("-", a[index]!);
      for (let index = hunk.xStart; index < hunk.xEnd; index++) output += line("+", b[index]!);
      position = hunk.oEnd;
    }
    for (; position < oEnd; position++) output += line(" ", a[position]!);
  }
  return output;
}
