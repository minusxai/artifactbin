/**
 * Two gates must never bind the same mail sink.
 *
 * Each gate that logs in binds its OWN sink port and the relay copies every
 * message to all of them (scripts/lib/mail-relay.mjs), so a gate finds its own
 * code by the address it asked for. That was a convenience while the set ran
 * one gate at a time; now that the set FANS OUT (scripts/gates.mjs --servers),
 * it is load-bearing — two gates sharing a port would race for one another's
 * mail, and a stolen code fails as a login timeout that names nothing.
 *
 * A port the relay does not know about is the same failure with a different
 * shape: the mail is sent, nothing forwards it, and the gate waits out its
 * timeout. So both facts are read off the gates themselves.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SINK_PORTS } from '../../../../scripts/lib/mail-relay.mjs';

const GATE_DIR = path.resolve(process.cwd(), '../../scripts');

/**
 * The port a gate's sink binds — handed to the shared helper inline, or named
 * by the const the two gates that roll their own sink server declare it with.
 */
const sinkPortOf = (source: string): number | null => {
  const port = source.match(/startMailSink\((\d{4})\)/) ?? source.match(/const SINK(?:_PORT)? = (\d{4})/);
  return port ? Number(port[1]) : null;
};

/** A gate that reads mail at all — whichever of the two shapes it uses. */
const READS_MAIL = /startMailSink|SINK(?:_PORT)? = \d/;

/** Every script that binds a mail sink — the gates, and the upgrade rehearsal. */
const SCRIPTS = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.mjs'));

const gates = SCRIPTS(GATE_DIR)
  .map((file) => ({ name: file, port: sinkPortOf(readFileSync(path.join(GATE_DIR, file), 'utf8')) }))
  .filter((g): g is { name: string; port: number } => g.port !== null);

describe('gate mail sinks', () => {
  it('is claimed by exactly one gate each', () => {
    const owners = new Map<number, string[]>();
    for (const gate of gates) owners.set(gate.port, [...(owners.get(gate.port) ?? []), gate.name]);
    const shared = [...owners].filter(([, names]) => names.length > 1);
    expect(shared.map(([port, names]) => `${port}: ${names.join(' + ')}`)).toEqual([]);
  });

  it('is a port the relay delivers to', () => {
    expect(gates.filter((g) => !SINK_PORTS.includes(g.port))).toEqual([]);
  });

  // A gate that logs in and never binds a sink waits for mail nothing catches.
  it('exists for every gate that logs in', () => {
    const logsIn = SCRIPTS(GATE_DIR)
      .filter((f) => READS_MAIL.test(readFileSync(path.join(GATE_DIR, f), 'utf8')));
    expect(logsIn.filter((f) => !gates.some((g) => g.name === f))).toEqual([]);
  });
});
