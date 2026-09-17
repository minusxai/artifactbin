/** Parse a browser-style srcset without treating the comma inside a data URL as a separator. */
export function parseSrcset(value: string): Array<{ url: string; descriptor: string }> {
  const out: Array<{ url: string; descriptor: string }> = [];
  let cursor = 0;
  while (cursor < value.length) {
    while (/[,\s]/.test(value[cursor] ?? '')) cursor++;
    if (cursor >= value.length) break;
    const start = cursor;
    while (cursor < value.length && !/\s/.test(value[cursor])) cursor++;
    let url = value.slice(start, cursor);
    // A trailing comma separates descriptor-less non-data candidates.
    if (!/^data:/i.test(url) && url.endsWith(',')) {
      url = url.slice(0, -1);
      if (url) out.push({ url, descriptor: '' });
      continue;
    }
    while (/\s/.test(value[cursor] ?? '')) cursor++;
    const descriptorStart = cursor;
    while (cursor < value.length && value[cursor] !== ',') cursor++;
    const descriptor = value.slice(descriptorStart, cursor).trim();
    if (cursor < value.length) cursor++;
    if (url) out.push({ url, descriptor });
  }
  return out;
}

/** `ping` is a whitespace-separated URL list, unlike srcset. */
export const parsePing = (value: string): string[] => value.trim().split(/\s+/).filter(Boolean);
