/** Keep session IDs in the wire value, while the textarea shows only @name. */
export function mentionDraft(raw: string) {
  const spans: Array<{ start: number; end: number; from: number; to: number }> = [];
  let text = '', cursor = 0;
  for (const match of raw.matchAll(/\[(@[^\]\n]+)\]\(\/chat\?session=[a-f0-9-]{36}\)/g)) {
    text += raw.slice(cursor, match.index);
    const from = text.length;
    text += match[1];
    cursor = match.index + match[0].length;
    spans.push({ start: match.index, end: cursor, from, to: text.length });
  }
  text += raw.slice(cursor);
  const toRaw = (position: number, edge: 'start' | 'end' = 'start') => {
    let offset = 0;
    for (const span of spans) {
      if (position <= span.from) break;
      if (position < span.to) return edge === 'start' ? span.start : span.end;
      offset += span.end - span.start - (span.to - span.from);
    }
    return position + offset;
  };
  const toDisplay = (position: number) => {
    let offset = 0;
    for (const span of spans) {
      if (position <= span.start) break;
      if (position < span.end) return span.from + Math.min(position - span.start, span.to - span.from);
      offset += span.end - span.start - (span.to - span.from);
    }
    return position - offset;
  };
  const edit = (next: string, caret: number) => {
    if (next === text) return raw;
    // Bound the diff by the actual caret so identical names keep their own IDs.
    let start = 0, tail = 0;
    while (start < caret && start < text.length && text[start] === next[start]) start++;
    while (tail < next.length - caret && tail < text.length - start &&
      text[text.length - tail - 1] === next[next.length - tail - 1]) tail++;
    let end = text.length - tail;
    let replacement = next.slice(start, next.length - tail);
    // Editing part of a mention turns that name into ordinary text, never a corrupted ID.
    const left = spans.find(s => start > s.from && start < s.to);
    const right = spans.find(s => end > s.from && end < s.to);
    if (left) { replacement = text.slice(left.from, start) + replacement; start = left.from; }
    if (right) { replacement += text.slice(end, right.to); end = right.to; }
    return raw.slice(0, toRaw(start)) + replacement + raw.slice(toRaw(end, 'end'));
  };
  return { text, toRaw, toDisplay, edit };
}
