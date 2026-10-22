/** Shape validation only. The importer must populate mappings from verified media receipts. */
export function canonicalMediaUrl(value: string): boolean {
  try {
    if (!value.startsWith("/") && !/^https?:\/\//.test(value)) return false;
    if (value.startsWith("//")) return false;
    const url = new URL(value, "https://example.invalid");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return false;
    const match =
      /^\/af\/v1\/ids\/[A-Za-z0-9]{6}\/assets\/([1-9][0-9]{0,15})\/(original|small)\/[a-f0-9]{64}$/.exec(
        url.pathname,
      );
    return !!match && Number.isSafeInteger(Number(match[1]));
  } catch {
    return false;
  }
}

/** Bounded srcset tokenizer: URL tokens may contain commas; descriptors never disappear. */
export function mappedSrcset(
  value: string,
  map: Readonly<Record<string, string>>,
): string | null {
  const space = (char: string | undefined) =>
    char !== undefined && /[\t\n\f\r ]/.test(char);
  const candidates: string[] = [];
  const descriptors = new Set<string>();
  let mode: string | undefined;
  let pos = 0;
  while (pos < value.length) {
    while (space(value[pos])) pos++;
    if (pos === value.length) break;
    if (value[pos] === ",") return null;
    const start = pos;
    while (pos < value.length && !space(value[pos])) pos++;
    let url = value.slice(start, pos),
      descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      while (space(value[pos])) pos++;
      const from = pos;
      while (pos < value.length && value[pos] !== ",") pos++;
      descriptor = value.slice(from, pos).trim();
      if (value[pos] === ",") pos++;
    }
    if (!url || !Object.hasOwn(map, url) || !canonicalMediaUrl(map[url]!))
      return null;
    const width = /^([0-9]+)w$/.exec(descriptor),
      density =
        /^((?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)x$/.exec(
          descriptor,
        );
    let currentMode = "x",
      number = 1;
    if (width) {
      currentMode = "w";
      number = Number(width[1]);
      if (!Number.isSafeInteger(number)) return null;
    } else if (density) number = Number(density[1]);
    else if (descriptor) return null;
    if (
      !Number.isFinite(number) ||
      number <= 0 ||
      (mode && mode !== currentMode)
    )
      return null;
    mode = currentMode;
    const key = currentMode + number;
    if (descriptors.has(key)) return null;
    descriptors.add(key);
    candidates.push(map[url] + (descriptor ? " " + descriptor : ""));
  }
  return candidates.length ? candidates.join(", ") : null;
}
