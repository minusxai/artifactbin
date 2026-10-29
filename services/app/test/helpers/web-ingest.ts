/**
 * Web-ingest's fetch policy in tests. Configuration freezes at import, so a suite that fetches its own loopback
 * fixture server admits it here, and a case that pins the production refusal restores the configured policy.
 * The one door tests use to web-ingest's policy seam; product code never calls it.
 */
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';

type WebIngestPolicy = NonNullable<Parameters<typeof setWebIngestPolicyForTests>[0]>;

/** An explicit policy, for a case that pins one (strict, or private without http). */
export const setWebIngestPolicy = (policy: WebIngestPolicy): void => setWebIngestPolicyForTests(policy);
/** Admit loopback and private addresses over plain http: a suite's own fixture servers. */
export const allowLocalWebIngest = (): void => setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });
/** Back to the configured policy (the deployment's: public https only unless the dev switch is on). */
export const restoreWebIngestPolicy = (): void => setWebIngestPolicyForTests(null);
