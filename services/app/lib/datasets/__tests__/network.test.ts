import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { resolvePostgresHost } from '../network';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
const lookupMock = vi.mocked(lookup);
const answers = (...addresses: string[]) => lookupMock.mockResolvedValue(addresses.map(address => ({ address, family: isIP(address) })) as never);

beforeEach(() => { vi.resetAllMocks(); answers('8.8.8.8'); });
afterEach(() => { vi.useRealTimers(); });

describe('PostgreSQL host resolution', () => {
  it('times out DNS without leaking diagnostics and caps uncancellable native work', async () => {
    vi.useFakeTimers();
    let complete!: (value: unknown) => void;
    lookupMock.mockImplementation(() => new Promise(resolve => { complete = resolve; }) as never);
    const pending = new Map<number, (value: unknown) => void>();
    const outcomes: Array<Promise<string>> = [];
    try {
      for (let index = 0; index < 8; index++) {
        outcomes.push(resolvePostgresHost(`slow-${index}.example.com`).then(() => 'accepted', error => error.message));
        pending.set(index, complete);
      }
      let message: string | undefined;
      const observed = outcomes[0].then(value => { message = value; });
      await vi.advanceTimersByTimeAsync(3001);
      expect(message).toBe('PostgreSQL host resolution timed out.');
      await observed;
      const refused = resolvePostgresHost('ninth.example.com').then(() => 'accepted', error => error.message);
      await vi.advanceTimersByTimeAsync(3001);
      expect(lookupMock).toHaveBeenCalledTimes(8);
      expect(await refused).toMatch(/busy/);
      if (lookupMock.mock.calls.length > 8) complete([{ address: '8.8.8.8', family: 4 }]);
    } finally {
      for (const resolve of pending.values()) resolve([{ address: '8.8.8.8', family: 4 }]);
      await Promise.all(outcomes);
    }
    answers('8.8.8.8');
    expect(await resolvePostgresHost('recovered.example.com')).toBe('8.8.8.8');
  });
  it('resolves all answers once and returns the first vetted address for socket pinning', async () => {
    answers('2606:4700:4700::1111', '8.8.8.8');
    expect(await resolvePostgresHost('warehouse.example.com')).toBe('2606:4700:4700::1111');
    expect(lookupMock).toHaveBeenCalledExactlyOnceWith('warehouse.example.com', { all: true, verbatim: true });
  });

  it.each([
    '0.0.0.0', '0.1.2.3', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.9.8.7',
    '169.254.169.254', '169.254.1.2', '172.16.0.1', '172.31.255.255', '192.168.1.2',
    '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:a00:1',
    '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:e000:1', '::ffff:0:0',
    '64:ff9b::a00:1', '64:ff9b:1::a00:1', '::127.0.0.1', '2002:7f00:1::', '2001::7f00:1', '2001:db8::1',
  ])('refuses non-public address %s in any DNS answer', async address => {
    answers('8.8.8.8', address);
    await expect(resolvePostgresHost('warehouse.example.com')).rejects.toThrow(/not permitted/);
  });

  it.each(['8.8.8.8', '172.15.255.255', '172.32.0.1', '11.0.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808'])('accepts public literal %s without a second DNS resolution', async address => {
    expect(await resolvePostgresHost(address)).toBe(address);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('accepts bracketed public IPv6 but returns the socket address without brackets', async () => {
    expect(await resolvePostgresHost('[2606:4700:4700::1111]')).toBe('2606:4700:4700::1111');
  });

  it.each(['127.0.0.1', '[::1]', '::ffff:7f00:1', '169.254.169.254'])('checks literal %s without consulting DNS', async host => {
    await expect(resolvePostgresHost(host)).rejects.toThrow(/not permitted/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(['localhost', 'localhost.localdomain', '2130706433', '0x7f000001', '0177.0.0.1', '127.1'])('checks DNS results for local or obfuscated host %s', async host => {
    answers('127.0.0.1');
    await expect(resolvePostgresHost(host)).rejects.toThrow(/not permitted/);
  });

  it.each(['', ' ', '/var/run/postgresql', './socket', '../socket', '@abstract-socket', 'unix:/tmp/pg', 'C:\\socket', 'db.example.com:5432', 'postgres://db.example.com', 'user:password@db.example.com', 'db.example.com/path', 'db.example.com\\path', 'db.example.com?x', 'db.example.com#x', 'db\u0000.example.com', ' db.example.com', 'db.example.com ', '[db.example.com]', 'fe80::1%en0', '[fe80::1%25en0]', 'not::an::ip', '.', '..'])('rejects invalid host %j before DNS, including with the private override', async host => {
    await expect(resolvePostgresHost(host, true)).rejects.toThrow(/valid hostname or IP address/);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('fails closed on no DNS answers', async () => {
    answers();
    await expect(resolvePostgresHost('warehouse.example.com')).rejects.toThrow(/could not be resolved/);
  });
  it('fails closed on DNS errors without exposing resolver diagnostics', async () => {
    lookupMock.mockRejectedValue(new Error('internal resolver detail'));
    await expect(resolvePostgresHost('warehouse.example.com')).rejects.toThrow('PostgreSQL host could not be resolved.');
  });
  it.each(['not-an-ip', '2606:bad::bad::1', 'fe80::1%en0', '127.0.0.1\n'])('rejects malformed resolver answer %j even with the private override', async address => {
    answers('8.8.8.8', address);
    await expect(resolvePostgresHost('warehouse.example.com', true)).rejects.toThrow(/not permitted/);
  });
  it('rejects a resolver family that disagrees with its address', async () => {
    lookupMock.mockResolvedValue([{ address: '8.8.8.8', family: 6 }] as never);
    await expect(resolvePostgresHost('warehouse.example.com')).rejects.toThrow(/not permitted/);
  });
});

describe('explicit self-host private network opt-in', () => {
  it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.2', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:a00:1', '0:0:0:0:0:ffff:c0a8:101'])('allows a private database at %s only when explicitly enabled', async address => {
    answers(address);
    await expect(resolvePostgresHost('postgres')).rejects.toThrow(/not permitted/);
    expect(await resolvePostgresHost('postgres', true)).toBe(address);
  });
  it.each(['169.254.169.254', '169.254.1.2', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::', 'fe80::1', 'ff02::1', '::ffff:a9fe:a9fe', '::ffff:e000:1', '::ffff:0:0'])('still refuses metadata, unspecified and non-database address %s', async address => {
    answers(address);
    await expect(resolvePostgresHost('postgres', true)).rejects.toThrow(/not permitted/);
  });
});
