import type { MediaAddress } from "./contracts.ts";
const pathPattern =
  /^\/af\/v1\/ids\/([A-Za-z0-9]{6})\/assets\/([1-9][0-9]{0,15})\/(original|small)\/([a-f0-9]{64})$/;
export function mediaAddress(value: MediaAddress, origin?: string): string {
  const path = `/af/v1/ids/${value.pageId}/assets/${value.revision}/${value.variant}/${value.sha256}`;
  if (!pathPattern.test(path) || !Number.isSafeInteger(Number(value.revision)))
    throw new Error("Invalid media address");
  if (origin === undefined) return path;
  const url = new URL(origin);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin !== origin
  )
    throw new Error("Invalid media origin");
  return origin + path;
}
export function parseMediaAddress(pathname: string): MediaAddress | null {
  const found = pathPattern.exec(pathname);
  if (!found || !Number.isSafeInteger(Number(found[2]))) return null;
  return {
    pageId: found[1]!,
    revision: found[2]!,
    variant: found[3] as MediaAddress["variant"],
    sha256: found[4]!,
  };
}
export function isMediaPath(pathname: string): boolean {
  return /^\/af\/v1\/ids\/[^/]+\/assets(?:\/|$)/.test(pathname);
}
