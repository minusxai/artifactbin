/** A separate email account for private-access acceptance, using the host's mailbox. */
export async function connectConformanceNonOwner({ base, accountEmail, stamp, credentialSource, env }, { acquireCredential, connectAgent }) {
  if (credentialSource) {
    const domain = accountEmail.slice(accountEmail.lastIndexOf('@') + 1);
    if (!accountEmail.startsWith('mxmx_test_') || !accountEmail.includes('@') || !domain) throw new Error('Acceptance requires a disposable email account');
    const email = `mxmx_test_conformance_other_${stamp}@${domain}`;
    if (email.toLowerCase() === accountEmail.toLowerCase()) throw new Error('Private-access acceptance requires a separate account');
    return acquireCredential(credentialSource, { base, env, email, localOutbox: env.EMAIL__DEV_OUTBOX_PATH });
  }
  return connectAgent(base);
}
