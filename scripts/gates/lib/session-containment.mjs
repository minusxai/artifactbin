/**
 * WHAT A SESSION'S CONTAINMENT PROBE MAY BE ASKED, ON THIS HOST.
 *
 * The sessions gate runs one script inside the worker and gets back four facts:
 * whether it could read this checkout, whether it could reach the network, whether
 * it could write its own directory, and which credentials its environment carried.
 *
 * Two of those are BUBBLEWRAP'S, not ours. Under `BROWSER__SANDBOX=none` — the
 * development loop on a host that has no bubblewrap — there is no namespace to
 * enforce them, and asserting them would fail for a reason that says nothing about
 * this code. So they are named, skipped and printed, never softened: Linux CI, where
 * the sandbox is on, still asserts all four. The two the PARENT owns — a writable
 * private directory and an environment carrying no credential — are asserted
 * everywhere, because those are ours to get wrong.
 */

/** The facts this code owns, true on every host. */
const OURS = { own: 'ok', credentials: [] };
/** The facts the Linux sandbox owns, and the names they are skipped under. */
const SANDBOX = { checkout: false, network: false };
export const CONTAINMENT_SKIPS = ['filesystem containment (probe.checkout)', 'network containment (probe.network)'];

/**
 * @param {string|undefined} sandbox the `sandbox` the SERVER reported on the session result
 * @returns {{expected: Record<string, unknown>, skipped: string[]}} what to compare, and what was left out
 */
export function containmentExpectation(sandbox) {
  return sandbox === 'none'
    ? { expected: { ...OURS }, skipped: [...CONTAINMENT_SKIPS] }
    : { expected: { ...SANDBOX, ...OURS }, skipped: [] };
}

/** The probe's result narrowed to the keys this host can be asked about. */
export function containmentObserved(result, expected) {
  return Object.fromEntries(Object.keys(expected).map((key) => [key, result?.[key]]));
}
