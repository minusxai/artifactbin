/** Exact archived-kit port. Only the trusted core address determines profile origin. */
export interface ArchivedPersonProfilePort {
  source: string;
  coreUrl: string;
}
export interface PersonProfileCoreAddress {
  src?: string | null;
  server?: string | null;
}
/** Missing or malformed platform metadata disables navigation; runner origin is never a fallback. */
export function compiledPersonProfileHref(
  handle: string | undefined,
  coreUrl: string,
  core?: PersonProfileCoreAddress,
): string | undefined {
  if (typeof handle !== "string" || !handle) return undefined;
  let address = coreUrl;
  if (address.startsWith("/")) address = core?.server || core?.src || "";
  try {
    const url = new URL(address);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    return url.origin + "/@" + encodeURIComponent(handle);
  } catch {
    return undefined;
  }
}
export function archivedPersonProfileSource({
  source,
  coreUrl,
}: ArchivedPersonProfilePort): string {
  const needle = "href={`/@${card()?.handle}`}";
  if (source.split(needle).length !== 2)
    throw Error("Unsupported archived person profile link");
  const metadata = `(()=>{const core=document.querySelector('script[data-af="core"]');return {server:core?.getAttribute('data-af-server'),src:core?.getAttribute('src')?core.src:null};})()`;
  const href = `__migrationPersonProfileHref(card()?.handle,${JSON.stringify(coreUrl)},${coreUrl.startsWith("/") ? metadata : "undefined"})`;
  return (
    `const __migrationPersonProfileHref=${compiledPersonProfileHref.toString()};\n` +
    source.replace(
      needle,
      `href={${href}} aria-disabled={${href} ? undefined : 'true'}`,
    )
  );
}
