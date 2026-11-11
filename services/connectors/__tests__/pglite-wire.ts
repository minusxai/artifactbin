/**
 * A REAL POSTGRES ON A LOOPBACK PORT FOR TESTS: PGlite (Postgres compiled to wasm, in this process) behind a TCP
 * listener speaking the wire protocol (`execProtocolRaw`), so the connector's postgres.js talks to it exactly as to
 * a server. PGlite is one backend, so the listener serves one socket at a time and queues the rest. It answers
 * SSLRequest 'N' (no TLS) and ignores startup parameters and passwords; it runs as a superuser (row policies do not
 * apply), so tests prove what the database sees with views keyed on `current_setting`.
 */
import net from 'node:net';
import { PGlite } from '@electric-sql/pglite';

export interface PgliteWire { port: number; db: PGlite; close(): Promise<void> }

export async function startPgliteWire(setup: string): Promise<PgliteWire> {
  const db = await PGlite.create();
  await db.exec(setup);
  const queue: net.Socket[] = [];
  let active: net.Socket | null = null;
  const next = () => { active = null; const s = queue.shift(); if (s) serve(s); };
  function serve(sock: net.Socket) {
    active = sock;
    let buf = Buffer.alloc(0), started = false, chain = Promise.resolve();
    sock.on('close', () => { void chain.then(next); });
    sock.on('error', () => sock.destroy());
    const pump = async () => {
      for (;;) {
        if (!started) {
          if (buf.length < 8) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          const msg = buf.subarray(0, len); buf = buf.subarray(len);
          if (len === 8 && msg.readInt32BE(4) === 80877103) { sock.write('N'); continue; }
          started = true;
          sock.write(Buffer.from(await db.execProtocolRaw(new Uint8Array(msg))));
          continue;
        }
        if (buf.length < 5) return;
        const len = buf.readInt32BE(1) + 1;
        if (buf.length < len) return;
        const msg = buf.subarray(0, len); buf = buf.subarray(len);
        if (msg[0] === 0x58) { sock.end(); return; }
        const out = await db.execProtocolRaw(new Uint8Array(msg));
        if (out.length && !sock.destroyed) sock.write(Buffer.from(out));
      }
    };
    const onData = (d: Buffer) => { buf = Buffer.concat([buf, d]); chain = chain.then(pump).catch(() => { sock.destroy(); }); };
    sock.on('data', onData);
    sock.resume();
  }
  const server = net.createServer((sock) => { sock.pause(); if (active) queue.push(sock); else serve(sock); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port, db,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await db.close(); },
  };
}
