/**
 * THE CLI'S ACCEPTANCE AGAINST A HOST, STANDALONE — the entry a downstream deployment runs: the private
 * composition's CI against its built services, and the deploy acceptance (minusxai/deploys) against the public host
 * with the released executable. The scenarios are scripts/gates/lib/cli-conformance.mjs, the `cli` leg of
 * scripts/gates/gate-accounts-and-workspace.mjs (the CI shard gate); this entry runs only that leg, and launches a
 * browser only when no CONFORMANCE__CREDENTIAL_SOURCE supplies the account — the production acceptance brings none.
 * It lives beside scripts/gates/, not in it: the shard manifest schedules every gate-*.mjs there, and this one is
 * downstream's to run.
 *
 *   usage: node scripts/gate-cli-conformance.mjs <base>
 *   env:   CONFORMANCE__CLI                the executable under test (default: services/cli/dist/afbin.mjs)
 *          CONFORMANCE__CREDENTIAL_SOURCE  the eval credential helper's source for the account (scripts/lib/credential.ts)
 */
import { createChecker } from './gates/lib/assert.mjs';
import { launchChromium } from './gates/lib/browser.mjs';
import { cliConformance } from './gates/lib/cli-conformance.mjs';
import { startMailSink } from './lib/mail-login.mjs';

const base = new URL(process.argv[2] ?? 'http://localhost:3030').origin;
const check = createChecker('cli-conformance');
const stamp = Date.now().toString(36);
const sink = await startMailSink();
const browser = process.env.CONFORMANCE__CREDENTIAL_SOURCE ? null : await launchChromium();
try {
  await cliConformance({ base, check, stamp, sink, context: () => browser.newContext({ viewport: { width: 1400, height: 950 } }) });
} finally {
  await browser?.close();
  sink.close();
}
check.done();
