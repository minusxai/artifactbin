/**
 * A REAL POSTGRES ON A LOOPBACK PORT FOR TESTS: PGlite (Postgres compiled to wasm, in this process) behind a TCP
 * listener speaking the wire protocol (`execProtocolRaw`), so the connector's postgres.js talks to it exactly as to
 * a server. PGlite is one backend: every socket's messages run through one queue, so sessions must not overlap
 * transactions (tests run their queries one after another). It answers
 * SSLRequest 'N' (no TLS) and ignores startup parameters and passwords; it runs as a superuser (row policies do not
 * apply), so tests prove what the database sees with views keyed on `current_setting`.
 */
import net from 'node:net';
import { PGlite } from '@electric-sql/pglite';

/** One frontend message as received: its type letter, and for Query and Parse its SQL text. */
interface WireMessage { type: string; sql?: string }
export interface PgliteWire { port: number; db: PGlite; messages: WireMessage[]; close(): Promise<void> }

export async function startPgliteWire(setup: string): Promise<PgliteWire> {
  const db = await PGlite.create();
  await db.exec(setup);
  const messages: WireMessage[] = [];
  let chain = Promise.resolve();
  function serve(sock: net.Socket) {
    let buf = Buffer.alloc(0), started = false;
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
        const type = String.fromCharCode(msg[0]!);
        // Query: its text; Parse: statement name, then its text, each NUL-terminated.
        const texts = msg.subarray(5).toString('utf8').split('\0');
        messages.push(type === 'Q' ? { type, sql: texts[0]! } : type === 'P' ? { type, sql: texts[1]! } : { type });
        if (msg[0] === 0x58) { sock.end(); return; }
        const out = await db.execProtocolRaw(new Uint8Array(msg));
        if (out.length && !sock.destroyed) sock.write(Buffer.from(out));
      }
    };
    const onData = (d: Buffer) => { buf = Buffer.concat([buf, d]); chain = chain.then(pump).catch(() => { sock.destroy(); }); };
    sock.on('data', onData);
  }
  const server = net.createServer(serve);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port, db, messages,
    close: async () => { await new Promise<void>((resolve) => server.close(() => resolve())); await db.close(); },
  };
}
