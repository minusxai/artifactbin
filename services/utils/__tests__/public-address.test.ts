/**
 * The address rules every host-side connection on a page's behalf obeys (web ingestion). Pure, so every range and
 * encoding gets a case.
 */
import { describe, expect, it } from 'vitest';
import { addressClass, hostNameSyntax, isAllowedAddress, parseIPv4, parseIPv6, parseOutboundIps } from '../src/public-address';

const CLASSES: Record<string, string[]> = {
  loopback: ['127.0.0.1', '127.255.255.254', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:0001', '64:ff9b::127.0.0.1', '64:ff9b::7f00:1'],
  private: ['10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '100.64.0.1', '100.127.255.255',
    'fc00::1', 'fd12:3456::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:192.168.1.1', '::ffff:6440:1', '64:ff9b::a00:1'],
  link_local: ['169.254.0.1', '169.254.169.254', 'fe80::1', 'febf::ffff', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe'],
  reserved: ['0.0.0.0', '0.1.2.3', '0.255.255.255', '192.0.0.1', '192.0.2.7', '192.88.99.1', '198.18.0.1', '198.19.255.255', '198.51.100.9', '203.0.113.9',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::127.0.0.1', '::7f00:1', '::8.8.8.8', '::ffff:0:7f00:1', '::ffff:0.0.0.0', '::ffff:224.0.0.1',
    '64:ff9b:1::1', '100::1', '2001::1', '2001:0:4136:e378::1', '2001:2::1', '2001:1ff::1', '2001:db8::1', '2002:7f00:1::1', '2002:808:808::1', '3fff::1',
    'fec0::1', 'ff02::1', 'ff0e::1', '1000::1', '4000::1', 'e000::1',
    // Not addresses at all: fail closed.
    '', 'not-an-ip', '1.2.3', '1.2.3.4.5', '256.0.0.1', '01.2.3.4', '0x7f.0.0.1', '2130706433', 'fe80::1%en0', '[::1]', '1:2:3:4:5:6:7:8:9', '::1::', '1::2::3', 'gggg::1', '1.2.3.4::'],
  public: ['1.1.1.1', '8.8.8.8', '93.184.216.34', '11.0.0.1', '9.255.255.255', '128.0.0.1', '223.255.255.255', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
    '169.253.255.255', '192.0.1.1', '192.169.0.1', '198.20.0.1',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450::1', '2001:200::1', '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '3fff:1000::1'],
};

describe('addressClass', () => {
  for (const [kind, addresses] of Object.entries(CLASSES))
    it.each(addresses)(`classifies %s as ${kind}`, (ip) => expect(addressClass(ip)).toBe(kind));
});

describe('isAllowedAddress', () => {
  it('admits only public addresses by default', () => {
    for (const [kind, addresses] of Object.entries(CLASSES))
      for (const ip of addresses) expect(isAllowedAddress(ip), ip).toBe(kind === 'public');
  });
  it('admits loopback, and only loopback, under the loopback opt-in', () => {
    for (const [kind, addresses] of Object.entries(CLASSES))
      for (const ip of addresses) expect(isAllowedAddress(ip, { allowLoopback: true }), ip).toBe(kind === 'public' || kind === 'loopback');
  });
  it('admits private ranges under the web-ingest dev policy, but never link-local (cloud metadata) or reserved space', () => {
    for (const [kind, addresses] of Object.entries(CLASSES))
      for (const ip of addresses) expect(isAllowedAddress(ip, { allowPrivate: true }), ip).toBe(kind === 'public' || kind === 'loopback' || kind === 'private');
  });
});

describe('parsers', () => {
  it('reads canonical IPv4 only', () => {
    expect(parseIPv4('10.0.0.1')).toEqual([10, 0, 0, 1]);
    for (const text of ['010.0.0.1', '1.2.3', '1.2.3.4.', '0x7f.0.0.1', ' 1.2.3.4', '1.2.3.-4', '1e2.0.0.1']) expect(parseIPv4(text), text).toBeNull();
  });
  it('expands IPv6, dotted tails included', () => {
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const text of ['1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8::', '12345::1', ':1', '1:', 'fe80::1%1']) expect(parseIPv6(text), text).toBeNull();
  });
});

describe('hostNameSyntax', () => {
  it('accepts DNS names, canonical literals and localhost, lowercased', () => {
    expect(hostNameSyntax('DB.Example.COM')).toBe('db.example.com');
    expect(hostNameSyntax('db.example.com.')).toBe('db.example.com');
    expect(hostNameSyntax('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
    expect(hostNameSyntax('a-b.c-d.io')).toBe('a-b.c-d.io');
    expect(hostNameSyntax('8.8.8.8')).toBe('8.8.8.8');
    expect(hostNameSyntax('[2001:4860::8888]')).toBe('2001:4860::8888');
    expect(hostNameSyntax('2001:4860::8888')).toBe('2001:4860::8888');
    expect(hostNameSyntax('localhost')).toBe('localhost');
  });
  it('refuses the numeric forms getaddrinfo reads as addresses, before any lookup', () => {
    for (const host of ['2130706433', '0x7f.1', '0x7f000001', '127.1', '127.0.1', '1.0x7f', '010.0.0.1', '0177.0.0.1', '1.2.3.4.5', '10.0.0.0.1', '1e2'])
      expect(hostNameSyntax(host), host).toBeNull();
  });
  it('refuses single labels, bad labels, URLs, ports, zones and oversize names', () => {
    for (const host of ['', 'postgres', 'db', '-a.example.com', 'a-.example.com', 'a..example.com', 'a_b.example.com', 'https://db.example.com', 'db.example.com:5432',
      'db.example.com/x', 'user@db.example.com', 'fe80::1%en0', '[::1', 'a'.repeat(64) + '.example.com', `${'a.'.repeat(127)}com`, ' db.example.com\n', 'db.example.123'])
      expect(hostNameSyntax(host), host).toBeNull();
  });
});

describe('parseOutboundIps (APP__OUTBOUND_IPS)', () => {
  it('is empty when unset or blank', () => {
    expect(parseOutboundIps(undefined)).toEqual([]);
    expect(parseOutboundIps('')).toEqual([]);
    expect(parseOutboundIps(' , ')).toEqual([]);
  });
  it('reads a comma-separated list of IPv4 and IPv6 addresses, trimmed, lowercased and without duplicates', () => {
    expect(parseOutboundIps('184.169.146.94')).toEqual(['184.169.146.94']);
    expect(parseOutboundIps(' 184.169.146.94 , 2600:1F1C:ABC::1,184.169.146.94,')).toEqual(['184.169.146.94', '2600:1f1c:abc::1']);
    expect(parseOutboundIps('::ffff:8.8.8.8')).toEqual(['::ffff:8.8.8.8']);
  });
  it.each(['example.com', '184.169.146', '256.1.1.1', '01.2.3.4', '[2600::1]', 'fe80::1%en0', '10.0.0.0/8', '1.2.3.4:5432', '1.2.3.4 5.6.7.8'])('refuses %s', (value) => {
    expect(() => parseOutboundIps(`184.169.146.94,${value}`)).toThrow('APP__OUTBOUND_IPS');
  });
});
