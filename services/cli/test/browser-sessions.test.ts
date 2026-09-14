import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cliHarness } from './harness';

test('sessions submits once, polls the same receipt, and preserves returned page IDs and images', async () => {
  const h = await cliHarness('afbin-browser-session-');
  try {
    await writeFile(join(h.root, 'actions.js'), 'const page=await context.newPage(); return page.url();');
    let ids: { session_id: string; execution_id: string } | undefined;
    const code = await h.invoke(['sessions', 'script', 'new', '--input', 'actions.js', '--json'], call => {
      assert.equal(call.path, '/api/browser-sessions');
      const body = call.body as Record<string, unknown>;
      if (body.op === 'script') {
        assert.equal(body.create, true);
        ids = { session_id: String(body.session_id), execution_id: String(body.execution_id) };
        return Response.json({ ...ids, status: 'queued', pages: [], attachments: [] });
      }
      assert.equal(body.op, 'status');
      assert.equal(body.execution_id, ids!.execution_id);
      return Response.json({ ...ids, status: 'completed', result: 42, pages: [{page_id:'page-one',url:'about:blank'}], attachments: [{mime:'image/png',base64:'image'}] });
    });
    assert.equal(code, 0, JSON.stringify(h.last()));
    assert.equal(h.last().result, 42);
    assert.equal(h.last().pages[0].page_id, 'page-one');
    assert.equal(h.calls.filter(call => (call.body as {op?:string})?.op === 'script').length, 1);
  } finally { await h.cleanup(); }
});
