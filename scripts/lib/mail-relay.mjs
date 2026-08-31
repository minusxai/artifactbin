/**
 * One mail endpoint for the dev server, every gate's sink behind it.
 *
 * Each mail gate binds its OWN sink port so two can run at once without
 * stealing each other's mail (scripts/lib/mail-login.mjs), but the app has a
 * single RESEND_BASE_URL — so pointing the dev server at one gate's port means
 * restarting it for the next gate. This relay is what makes one restart enough:
 * the server posts here, and every known sink port gets a copy. Whichever gate
 * is actually listening finds its code; the rest are refused connections and
 * ignored.
 *
 * Fan-out is safe because a sink only ever READS the last message matching what
 * it asked for, and gate addresses are unique per run (mxmx_test_<gate>_<ts>).
 *
 *   RESEND_API_KEY=x RESEND_BASE_URL=http://127.0.0.1:4600 npm run dev -- -p 3040
 *   node scripts/lib/mail-relay.mjs        # keep running alongside the gates
 *
 * A gate that owns a port this relay also targets (gate-visibility, 4605) still
 * works: it binds first, the relay simply delivers to it.
 */
import { createServer, request as httpRequest } from 'http';
import { pathToFileURL } from 'node:url';

/** Every port a scripts/gate-*.mjs sink is known to bind. */
export const SINK_PORTS = [4598, 4599, 4601, 4602, 4603, 4604, 4605, 4606, 4611, 4612, 4613];

const RELAY_PORT = Number(process.argv[2] ?? 4600);

function forward(port, body) {
  return new Promise((resolve) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/emails', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    // A sink that is not running is the normal case, not an error.
    req.on('error', resolve);
    req.end(body);
  });
}

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    await Promise.all(SINK_PORTS.map((p) => forward(p, body)));
    // Answer in Resend's shape so lib/email treats the send as successful.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'relayed' }));
  });
});

// Listening is what RUNNING this does, not what importing it does: the port
// list is read by a guard (lib/__tests__/gate-ports.test.ts), and a module that
// binds a port on import fails that test with an EADDRINUSE from itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(RELAY_PORT, '127.0.0.1', () => {
    console.log(`mail relay on http://127.0.0.1:${RELAY_PORT} → sinks ${SINK_PORTS.join(', ')}`);
  });
}
