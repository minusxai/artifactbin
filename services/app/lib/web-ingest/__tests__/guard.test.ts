/**
 * The SSRF boundary, exhaustively. Everything here is pure — no sockets — so
 * every range and obfuscation gets a case. The fetcher (fetch.test.ts) proves
 * these rules are actually consulted per CONNECTION; this file proves the
 * rules themselves are right, which a live test could only sample.
 */
import { describe, expect, it } from 'vitest';
import { isForbiddenIp, parseWebUrl, WebIngestError } from '../guard';

const STRICT = { allowPrivate: false, allowHttp: false };
const LAX = { allowPrivate: true, allowHttp: true };

describe('isForbiddenIp — IPv4', () => {
  const forbidden = [
    '0.0.0.0', '0.255.255.255',            // "this network"
    '10.0.0.1', '10.255.255.255',          // RFC1918
    '100.64.0.1', '100.127.255.255',       // CGNAT
    '127.0.0.1', '127.255.255.254',        // loopback
    '169.254.1.1', '169.254.169.254',      // link-local + the cloud metadata IP
    '172.16.0.1', '172.31.255.255',        // RFC1918
    '192.0.0.1',                           // IETF protocol assignments
    '192.0.2.7',                           // TEST-NET-1
    '192.168.0.1', '192.168.255.255',      // RFC1918
    '198.18.0.1', '198.19.255.255',        // benchmarking
    '198.51.100.9', '203.0.113.9',         // TEST-NET-2/3
    '224.0.0.1', '239.255.255.255',        // multicast
    '240.0.0.1', '255.255.255.255',        // reserved + broadcast
  ];
  it.each(forbidden)('refuses %s', (ip) => expect(isForbiddenIp(ip)).toBe(true));

  const allowed = [
    '1.1.1.1', '8.8.8.8', '93.184.216.34', // public
    '11.0.0.1',                            // just past 10/8
    '172.15.255.255', '172.32.0.1',        // just outside 172.16/12
    '100.63.255.255', '100.128.0.1',       // just outside CGNAT
    '9.255.255.255', '128.0.0.1', '223.255.255.255',
  ];
  it.each(allowed)('allows %s', (ip) => expect(isForbiddenIp(ip)).toBe(false));
});

describe('isForbiddenIp — IPv6', () => {
  const forbidden = [
    '::', '::1',                            // unspecified + loopback
    'fc00::1', 'fd12:3456::1',              // unique-local fc00::/7
    'fe80::1', 'febf::1',                   // link-local fe80::/10
    '2001:db8::1',                          // documentation
    'ff02::1',                              // multicast
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',  // v4-mapped: the classic bypass
    '::ffff:169.254.169.254',
    '64:ff9b::a00:1',                       // NAT64 — embeds a v4 we cannot see
  ];
  it.each(forbidden)('refuses %s', (ip) => expect(isForbiddenIp(ip)).toBe(true));

  const allowed = ['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'];
  it.each(allowed)('allows %s', (ip) => expect(isForbiddenIp(ip)).toBe(false));

  it('refuses anything it cannot parse — fail closed, never open', () => {
    expect(isForbiddenIp('not-an-ip')).toBe(true);
    expect(isForbiddenIp('')).toBe(true);
    expect(isForbiddenIp('1.2.3')).toBe(true);
    expect(isForbiddenIp('1.2.3.4.5')).toBe(true);
  });
});

describe('parseWebUrl', () => {
  it('accepts a plain https URL', () => {
    const u = parseWebUrl('https://example.com/a.png', STRICT);
    expect(u.hostname).toBe('example.com');
  });

  it('refuses http unless the policy allows it', () => {
    expect(() => parseWebUrl('http://example.com/a.png', STRICT)).toThrow(WebIngestError);
    expect(parseWebUrl('http://example.com/a.png', LAX).protocol).toBe('http:');
  });

  it('refuses non-web schemes outright, policy or no policy', () => {
    for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'gopher://x', 'data:image/png;base64,x']) {
      expect(() => parseWebUrl(url, LAX)).toThrow(WebIngestError);
    }
  });

  it('refuses credentials in the URL — nothing here may carry auth anywhere', () => {
    expect(() => parseWebUrl('https://user:pass@example.com/x', STRICT)).toThrow(WebIngestError);
    expect(() => parseWebUrl('https://user@example.com/x', STRICT)).toThrow(WebIngestError);
  });

  it('refuses non-default ports — 443 (or none) only', () => {
    expect(() => parseWebUrl('https://example.com:8443/x', STRICT)).toThrow(WebIngestError);
    expect(parseWebUrl('https://example.com:443/x', STRICT)).toBeTruthy();
  });

  it('sees through IPv4 obfuscation, because WHATWG normalizes it before we check', () => {
    // 0x7f000001, 2130706433 and 017700000001 are all 127.0.0.1.
    for (const host of ['0x7f000001', '2130706433', '0177.0.0.1', '127.1']) {
      expect(() => parseWebUrl(`https://${host}/x`, STRICT)).toThrow(WebIngestError);
    }
  });

  it('refuses literal private IPs and bracketed v6 loopback', () => {
    expect(() => parseWebUrl('https://10.0.0.5/x', STRICT)).toThrow(WebIngestError);
    expect(() => parseWebUrl('https://[::1]/x', STRICT)).toThrow(WebIngestError);
    expect(() => parseWebUrl('https://169.254.169.254/latest/meta-data', STRICT)).toThrow(WebIngestError);
  });

  it('allows a literal private IP only under the dev policy', () => {
    expect(parseWebUrl('http://127.0.0.1:443/x', { allowPrivate: true, allowHttp: true })).toBeTruthy();
  });

  it('refuses garbage', () => {
    expect(() => parseWebUrl('not a url', STRICT)).toThrow(WebIngestError);
    expect(() => parseWebUrl('', STRICT)).toThrow(WebIngestError);
  });
});
