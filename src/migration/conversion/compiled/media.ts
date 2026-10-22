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
