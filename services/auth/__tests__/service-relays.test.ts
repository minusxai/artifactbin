/** The chart-image and draft-check relays admit a service's own credential and forward only the exact body. */
import { expect, it } from 'vitest';
import { ANONYMOUS, type Actor } from '@artifactbin/contracts/actor';
import { CANONICAL_CHART_IMAGE_PATH, CANONICAL_DRAFT_CHECK_PATH } from '@artifactbin/contracts/identity-service';
import { SERVICE_PAYLOAD_LIMIT } from '@artifactbin/contracts/payload-limit';
import { SERVICE_AUTH_HEADER } from '@artifactbin/contracts/routes';
import { CHART_IMAGE_PATH, DRAFT_CHECK_PATH } from '../src/session-authority';
import { delegatedService, serviceAuthHost, serviceAudiences } from './helpers';

const audiences = serviceAudiences(
  { ...delegatedService('warehouse', 'https://warehouse.example', 'service-secret'), artifact_reads: true },
  delegatedService('mailer', 'https://mailer.example', 'mailer-secret'),
);
const chart = { mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' } } };
const rows = [{ k: 'a', v: 1 }];
const draft = { html: '<af-chart></af-chart>', entryPath: 'report.html', files: [{ path: 'data.csv', base64: 'YQo=' }] };

it.each([
  {
    name: 'chart image',
    path: CHART_IMAGE_PATH,
    canonicalPath: CANONICAL_CHART_IMAGE_PATH,
    valid: { chart, rows },
    accepted: { chart, rows, width: 320, height: 200, theme: 'dark', designSystem: 'volta' },
    invalid: [{ chart }, { rows }, { chart, rows, grant: 'arg_x' }, { chart, rows, userId: 'usr_1' }, [chart, rows]],
    oversizedRequest: (large: string) => ({ chart, rows: large }),
    ok: { mime: 'image/png', width: 640, height: 400, bytes: 3, data: 'AAAA' },
    refusal: {
      status: 422,
      body: { error: 'image_too_large', message: 'the PNG is 150000 bytes, past 140000', hint: 'ask for a smaller width and height' },
    },
    oversizedAnswer: (large: string) => ({ data: large }),
    unavailable: 'render_unavailable',
  },
  {
    name: 'draft check',
    path: DRAFT_CHECK_PATH,
    canonicalPath: CANONICAL_DRAFT_CHECK_PATH,
    valid: draft,
    accepted: draft,
    invalid: [{ html: draft.html }, { files: [] }, { ...draft, liveSql: true }, { ...draft, grant: 'arg_x' }, [draft]],
    oversizedRequest: (large: string) => ({ ...draft, html: large }),
    ok: {
      problems: [{ kind: 'component', element: 'af-chart', code: 'invalid_chart', label: 'Monthly revenue', message: 'Chart not drawn: the spec is not valid' }],
      truncated: false,
    },
    refusal: { status: 400, body: { error: 'unresolved_draft_files', message: 'gone.png is not among the files' } },
    oversizedAnswer: (large: string) => ({ problems: [{ kind: 'console', message: large }], truncated: false }),
    unavailable: 'check_unavailable',
  },
])('$name admits only opted-in services, forwards anonymously and relays the app response', async ({
  path, canonicalPath, valid, accepted, invalid, oversizedRequest, ok, refusal, oversizedAnswer, unavailable,
}) => {
  const forwarded: { request: Request; body: string; actor: Actor }[] = [];
  let answer = () => Response.json(ok);
  const app = serviceAuthHost({
    env: { IDENTITY__SERVICE_AUDIENCES: audiences, INTERNAL__SERVICE_SECRET: 'installation-secret' },
    upstream: async (request, actor) => {
      forwarded.push({ request, body: await request.text(), actor });
      return answer();
    },
  });
  const call = (body: unknown, secret: string | null = 'service-secret', method = 'POST') =>
    app.request(path, {
      method,
      headers: {
        authorization: 'Bearer ignored',
        cookie: 'session=ignored',
        ...(secret === null ? {} : { [SERVICE_AUTH_HEADER]: secret }),
      },
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });

  for (const secret of [null, 'wrong', 'mailer-secret', 'installation-secret']) {
    expect((await call(valid, secret)).status).toBe(401);
  }
  expect((await call(valid, 'service-secret', 'GET')).status).toBe(405);
  for (const body of [...invalid, 'not json']) {
    expect((await call(body)).status, JSON.stringify(body)).toBe(400);
  }
  const large = 'x'.repeat(SERVICE_PAYLOAD_LIMIT);
  expect((await call(oversizedRequest(large))).status).toBe(413);
  expect(forwarded).toHaveLength(0);

  const response = await call(accepted);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(await response.json()).toEqual(ok);
  expect(forwarded).toHaveLength(1);
  const { request, body, actor } = forwarded[0]!;
  expect(request.method).toBe('POST');
  expect(new URL(request.url).pathname).toBe(canonicalPath);
  expect([...request.headers].filter(([name]) => name !== 'content-type')).toEqual([]);
  expect(actor).toEqual(ANONYMOUS);
  expect(JSON.parse(body)).toEqual(accepted);

  answer = () => Response.json(refusal.body, { status: refusal.status });
  const refused = await call(valid);
  expect(refused.status).toBe(refusal.status);
  expect(await refused.json()).toEqual(refusal.body);

  answer = () => Response.json(oversizedAnswer(large));
  const oversized = await call(valid);
  expect(oversized.status).toBe(413);
  expect(await oversized.json()).toEqual({ error: 'too_large', max: SERVICE_PAYLOAD_LIMIT });

  answer = () => { throw Error('app down'); };
  const down = await call(valid);
  expect(down.status).toBe(503);
  expect(await down.json()).toEqual({ error: unavailable });
});
