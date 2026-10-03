import { Hono } from 'hono';
import { actorOf, actorReceiver } from '@artifactbin/utils';
import type { RunnerService } from '@artifactbin/contracts';
/** No unsigned owner headers: identity is attached in-process or verified at the HTTP boundary. */
export function runnerHttp(runner: RunnerService, secret?: string) {
    const app = new Hono();
    if (secret)
        actorReceiver(secret).mount(app);
    app.use('*', async (c, next) => { if (!actorOf(c.req.raw)?.userId)
        return c.json({ error: 'unauthorized' }, 401); await next(); });
    app.onError((e, c) => { const code = e.message; const status = code === 'not_found' ? 404 : code === 'start_conflict' ? 409 : code === 'queue_full' ? 429 : code === 'runner_closed' ? 503 : code.startsWith('invalid_') || code.includes('limit') || code.includes('import_not_allowed') ? 400 : 500; return c.json({ error: status === 500 ? 'runner_failed' : code }, status); });
    app.post('/v1/runs', async (c) => { const body = await readJson(c.req.raw); if (body.userId !== actorOf(c.req.raw)!.userId)
        return c.json({ error: 'identity_mismatch' }, 403); return c.json(await runner.start(body), 202); });
    app.get('/v1/runs/:id', async (c) => c.json(await runner.getRun({ userId: actorOf(c.req.raw)!.userId!, runId: c.req.param('id') })));
    app.get('/v1/runs/:id/events', async (c) => c.json(await runner.events({ userId: actorOf(c.req.raw)!.userId!, runId: c.req.param('id'), afterSequence: Number(c.req.query('after') ?? 0), limit: Number(c.req.query('limit') ?? 100) })));
    app.post('/v1/runs/:id/cancel', async (c) => { await runner.cancel({ userId: actorOf(c.req.raw)!.userId!, runId: c.req.param('id') }); return c.json({ ok: true }); });
    return app;
}
async function readJson(request: Request) {
    if (!request.body)
        throw Error('invalid_body');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 512 * 1024)
                throw Error('body_limit');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel();
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw Error('invalid_json');
    }
}
