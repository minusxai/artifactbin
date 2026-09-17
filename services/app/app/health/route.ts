/**
 * GET /health — is this process able to serve?
 *
 * Found on production the day #157 deployed: the container was reported
 * UNHEALTHY, failing streak 7, while serving every page correctly. Its probe
 * fetched `/docs/llm`, an address the docs tree had retired. A liveness probe
 * that asks whether a particular DOCUMENT still exists turns any content
 * change into a red deployment — and a permanently-red check is one nobody
 * reads on the day it finally means something.
 *
 * So the probe gets its own address: boring, credential-free, and never
 * allowed to move.
 *
 * DELIBERATELY SHALLOW — it does not touch the database or the object store.
 * A probe that fails when Postgres blips restarts a server that would have
 * recovered on its own, and whether the object store is reachable is the
 * DEPLOYER's question, answered where the configuration is set rather than by
 * every process that starts. Answering here means the event loop is alive and routing works,
 * which is exactly what an orchestrator should restart a container over.
 */

export async function GET(_request: Request): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
