/** Exact archived-kit port. Only the trusted core address determines profile origin. */
export interface ArchivedPersonProfilePort {
  source: string;
  coreUrl: string;
}
export function archivedPersonProfileSource({
  source,
  coreUrl,
}: ArchivedPersonProfilePort): string {
  const needle = "href={`/@${card()?.handle}`}";
  if (source.split(needle).length !== 2)
    throw Error("Unsupported archived person profile link");
  let origin: string | null = null;
  try {
    origin = new URL(coreUrl).origin;
  } catch {}
  const base = origin
    ? JSON.stringify(origin)
    : `(()=>{const core=document.querySelector('script[data-af="core"]');const address=core?.getAttribute('data-af-server')||core?.src;if(!address)throw Error('Profile origin unavailable');return new URL(address).origin;})()`;
  return source.replace(
    needle,
    `href={new URL('/@'+encodeURIComponent(card()?.handle ?? ''),${base}).href}`,
  );
}
