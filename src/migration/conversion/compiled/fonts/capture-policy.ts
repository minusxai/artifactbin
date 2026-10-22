import { BlockList, isIP } from "node:net";
import { parsePinnedFontRequest } from "./inline.ts";
/** Route checks use original bytes before URL normalization. Never admit an arbitrary host. */
export function fontCaptureAddress(
  raw: string,
  kind: "stylesheet" | "font",
): URL {
  if (kind === "stylesheet") {
    parsePinnedFontRequest(raw);
    return new URL(raw);
  }
  if (
    raw.length > 1024 ||
    !/^https:\/\/fonts\.gstatic\.com\/s\/[a-z0-9-]+\/v[1-9][0-9]{0,5}\/[A-Za-z0-9_-]{1,256}\.woff2$/.test(
      raw,
    )
  )
    throw Error("Unsupported captured font resource address");
  return new URL(raw);
}
const denied4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied4.addSubnet(address, prefix, "ipv4");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
const denied6 = new BlockList();
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  denied6.addSubnet(address, prefix, "ipv6");
/** DNS answers are all checked, then one approved IP is pinned by the capture transport. */
export function isPublicFontAddress(address: string): boolean {
  if (address.includes("%")) return false;
  const family = isIP(address);
  return family === 4
    ? !denied4.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !denied6.check(address, "ipv6");
}
