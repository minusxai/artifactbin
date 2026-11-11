/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Private loopback preview of a local project; Ctrl-C stops it.
Never publishes, signs in or reads credentials.
Usage: node scripts/serve.mjs PROJECT_DIR [--port N] [--autofix]
Flags: --port N (default 0 picks a free port); --autofix also writes autofix fixes into each served
  HTML file (default: serve the fixed bytes and leave the file unchanged).
  Common: --json, --output FILE, --help. --server is refused.
Examples:
  node scripts/serve.mjs ./project --port 7474  # open the printed loopback URL;
                                                # PROJECT_DIR needs index.html
  node scripts/check.mjs http://127.0.0.1:7474/ --viewport 1280x800 --steps acceptance.mjs
    --output qa.json
Gotchas:
  - Use a dedicated directory of intended files only: dotfiles, listings, traversal and outside
    symlinks are refused.
  - The preview adds the core runtime and serves it, the @afbin/ libraries and components, the
    platform stylesheet and fonts from its own origin, fetched once from the server (so it needs
    the network). A restrictive CSP blocks other remote subresources, connections, frames and
    workers; ref: assets need local files. It is not a sandbox for hostile pages (use OS
    isolation) and does not run publication validation.
  - Edits on disk show "File changed - Reload" (the project is polled every 1.5 s); the running
    page is never patched.
  - sql runs only in the published page: here it rejects with unavailable; publish, then check
    the published page.
  - The toolbar's Save HTML downloads a packed portable copy; it never overwrites the file or
    publishes.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import {runTool, positional, integer, ToolError} from './toolbox-client.mjs';
import {startPreview} from './preview-server.mjs';
// Start the preview and print one JSON receipt with the loopback URL; the process then stays up
// until a signal.
async function serveCommand({values, positionals}) {
  if (values.server)
    throw new ToolError(
      'unsupported_server', 'Private serve does not connect to a remote server.', 2);
  // Limits (enforced in preview-server.mjs): the project is capped at 2,000 files, 32 MiB per
  // file and 128 MiB.
  const session = await startPreview({
    root: positional(positionals),
    port: values.port === undefined ? 0 : integer(values.port, 'port', 0, 65535),
    autofix: {write: values.autofix === true, report: text => process.stderr.write(text)}
  });
  const receipt = {
    ok: true,
    code: 'serving',
    url: session.url,
    private: true,
    note: 'Loopback preview. Ctrl-C stops it.'
  };
  if (values.output) {
    const {exclusive} = await import('./toolbox-client.mjs');
    await exclusive(values.output, JSON.stringify(receipt) + '\n');
  }
  process.stdout.write(JSON.stringify(receipt) + '\n');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void session.close();
    });
}
await runTool('serve', import.meta.url, serveCommand);
