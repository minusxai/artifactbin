/**
 * WHERE A CONNECTION MAY REACH, the rule the runner's database tunnel applies (services/runner/src/database-tunnel.ts):
 * the host name is resolved once per new session, EVERY answer must be allowed (one private answer refuses them all)
 * and the socket connects to the exact address judged, so DNS cannot switch it to an internal one between the check
 * and the connect. Allowed: public addresses; with the install's `allowPrivateNetwork` (development, or a database on
 * the install's own network) also loopback and private ones. Link-local, which holds the cloud metadata address, never.
 * TLS: `tls: 'disable'` only under `allowPrivateNetwork`; otherwise TLS 1.2+ with the certificate and name verified.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import type { ConnectionConfig, ConnectorNetworkPolicy } from '@artifactbin/contracts';
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { hostNameSyntax, isAllowedAddress, parseIPv4, parseIPv6 } from '@artifactbin/utils/public-address';
import { ConnectorFailure } from './errors';

interface LookupAddress { address: string; family: number }
export interface NetworkSeams {
  /** Every address a name resolves to (default: `dns.lookup` with `all`). */
  lookup?: (host: string) => Promise<LookupAddress[]>;
}
export interface Target { host: string; port: number; tls: false | { rejectUnauthorized: true; minVersion: 'TLSv1.2'; ca?: string } }

const isIp = (host: string) => !!parseIPv4(host) || !!parseIPv6(host);
const policyOf = (p: ConnectorNetworkPolicy) => ({ allowPrivate: p.allowPrivateNetwork });

/** The configuration's host, port and TLS, judged before anything is resolved. */
export function targetOf(config: ConnectionConfig, policy: ConnectorNetworkPolicy): Target {
  const host = typeof config.host === 'string' ? hostNameSyntax(config.host) : null;
  if (!host) throw new ConnectorFailure('invalid_config', 'host must be a host name or an IP address');
  if (isIp(host) && !isAllowedAddress(host, policyOf(policy))) throw new ConnectorFailure('forbidden_address', 'the host is not a public address');
  if (config.tls === 'disable' && !policy.allowPrivateNetwork) throw new ConnectorFailure('tls_required', 'TLS is required: tls "disable" is allowed only where the install allows private networks');
  const tls = config.tls === 'disable' ? false as const : { rejectUnauthorized: true as const, minVersion: 'TLSv1.2' as const, ...(typeof config.ca === 'string' ? { ca: config.ca } : {}) };
  return { host, port: Number(config.port), tls };
}

/** Resolves and judges the host, then opens one TCP socket to an address judged. */
export async function connectTarget(target: Target, policy: ConnectorNetworkPolicy, seams: NetworkSeams = {}): Promise<net.Socket> {
  const lookup = seams.lookup ?? (async (h: string) => dns.lookup(h, { all: true, verbatim: true }));
  let addresses: LookupAddress[];
  if (isIp(target.host)) addresses = [{ address: target.host, family: parseIPv4(target.host) ? 4 : 6 }];
  else {
    try { addresses = await lookup(target.host); } catch { throw new ConnectorFailure('connect_failed', 'the host name did not resolve'); }
  }
  if (!addresses.length) throw new ConnectorFailure('connect_failed', 'the host name did not resolve');
  if (!addresses.every((a) => typeof a?.address === 'string' && isAllowedAddress(a.address, policyOf(policy)))) throw new ConnectorFailure('forbidden_address', 'the host resolves to an address that is not public');
  for (const { address, family } of addresses) {
    const socket = net.connect({ host: address, port: target.port, family: family === 6 ? 6 : 4 });
    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CONNECTOR_LIMITS.connectTimeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(true); });
      socket.once('error', () => { clearTimeout(timer); resolve(false); });
    });
    if (ok) return socket;
    socket.destroy();
  }
  throw new ConnectorFailure('connect_failed', 'the database could not be reached');
}
