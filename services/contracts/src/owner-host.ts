/** Syntax shared by owner-host routers. Each caller applies its own routing and ownership policy. */
import { ARTIFACT_ID_PATTERN } from './artifact-reference';
import { isValidHandle } from './handles';

const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Normalize a bare DNS name, or null when unset. Callers decide whether to allow single labels or IP literals. */
export function parseDnsHostname(value: string | undefined): string | null {
  const hostname = value?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  if (!hostname) return null;
  if (hostname.length > 253 || !hostname.split('.').every(label => dnsLabel.test(label))) {
    throw new Error('Expected a bare DNS hostname');
  }
  return hostname;
}

/** Check normalized names. A pages ancestor is allowed except at a reserved hex child label. */
export function ownerHostConflicts(base: string | null, normalizedOwnHosts: readonly string[], pages: string | null): boolean {
  if (!base) return false;
  const underBase = (host: string) => host === base || host.endsWith(`.${base}`);
  if (normalizedOwnHosts.some(underBase)) return true;
  if (!pages) return false;
  const pagesSuffix = `.${pages}`;
  return underBase(pages) || (base.endsWith(pagesSuffix) && /^[a-f0-9]+$/.test(base.slice(0, -pagesSuffix.length)));
}

/** Decode a DNS owner label to the account/group handle it spells. */
export function ownerHandleFromLabel(label: string): string | null {
  if (!dnsLabel.test(label)) return null;
  const handle = label.replaceAll('-', '_');
  return isValidHandle(handle) ? handle : null;
}

/** Parse a single child label, optionally with a DNS-shaped alias after '--'. */
export function ownerSiteAddress(host: string, base: string | null): { handle: string; label: string } | null {
  if (!base) return null;
  const hostname = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const suffix = `.${base.toLowerCase().replace(/\.$/, '')}`;
  if (hostname.length > 253 || !hostname.endsWith(suffix)) return null;
  const child = hostname.slice(0, -suffix.length);
  if (!dnsLabel.test(child)) return null;
  const separator = child.indexOf('--');
  const handle = ownerHandleFromLabel(separator < 0 ? child : child.slice(0, separator));
  const label = separator < 0 ? '' : child.slice(separator + 2);
  return handle && (separator < 0 || dnsLabel.test(label)) ? { handle, label } : null;
}

/** Decode the lowercase hex of a case-sensitive published artifact ID. */
export function idFromPagesLabel(label: string): string | null {
  if (!/^(?:[0-9a-f]{2}){1,32}$/.test(label)) return null;
  const id = label.replace(/[0-9a-f]{2}/g, byte => String.fromCharCode(Number.parseInt(byte, 16)));
  return ARTIFACT_ID_PATTERN.test(id) ? id : null;
}

/** Path-only classifiers. The caller decides methods, ID bounds and access. */
export function ownerSqlArtifactId(path: string): string | null {
  return /^\/api\/artifacts\/([A-Za-z0-9]+)\/sql$/.exec(path)?.[1] ?? null;
}

export function ownerFolderId(path: string): string | null {
  return /^\/folders\/([A-Za-z0-9]+)\/?$/.exec(path)?.[1] ?? null;
}

type DocumentDoor = 'raw' | 'resolve' | 'export' | 'events' | 'events/frame' | 'assets';

export function ownerDocumentDoor(path: string): { id: string; door: DocumentDoor } | null {
  const match = /^\/a\/([A-Za-z0-9]+)\/(raw|resolve|export|events|events\/frame|assets)$/.exec(path);
  return match ? { id: match[1]!, door: match[2] as DocumentDoor } : null;
}

const reservedTitleRoots = new Set(['a', 'af', 'api', 'assets', 'folders']);

/** A title path uses lowercase slugs and may end in a directory slash. */
export function isOwnerTitlePath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  const parts = path.slice(1).replace(/\/$/, '').split('/');
  return !reservedTitleRoots.has(parts[0]!) && parts.every(part => part.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(part));
}
