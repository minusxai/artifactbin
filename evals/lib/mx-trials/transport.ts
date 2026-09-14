import { request, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';

/** Host and port belong to the driver. User input can affect only the HTTP path. */
export function createTrialTransport(port = 3391) {
  return async (target: string, init: { method: string; headers: IncomingHttpHeaders; body?: Uint8Array }): Promise<Response> => {
    const url = trialUpstreamUrl(target);
    return await new Promise((resolve, reject) => {
      const pending = request({hostname:'127.0.0.1', port, path:url.pathname + url.search, method:init.method,
        headers:{...init.headers, 'accept-encoding':'identity'}}, response => {
        const headers = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) headers.append(response.rawHeaders[i]!, response.rawHeaders[i+1]!);
        const status = response.statusCode ?? 502;
        const noBody = init.method === 'HEAD' || [204,205,304].includes(status);
        if (noBody) response.resume();
        resolve(new Response(noBody ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>, {status, headers}));
      });
      pending.on('error', reject);
      pending.setTimeout(120_000, () => pending.destroy(new Error('Trial upstream timeout')));
      pending.end(init.body);
    });
  };
}

/** The trial relay may address only its driver-owned app, never a request-selected host. */
export function trialUpstreamUrl(target: string): URL {
  if (!target.startsWith('/') || target.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(target)) {
    throw new Error('Expected an origin-relative request target');
  }
  const url = new URL(target, 'http://127.0.0.1:3391');
  if (url.origin !== 'http://127.0.0.1:3391' || url.username || url.password) {
    throw new Error('Trial upstream origin cannot change');
  }
  return url;
}

/** IDs from HTTP responses are data, including when embedded in a harness prompt. */
export function trialArtifactId(value: unknown): string {
  if (typeof value !== 'string' || !ARTIFACT_ID_PATTERN.test(value)) throw new Error('Invalid published artifact ID');
  return value;
}

export function writeTrialError(res: ServerResponse): void {
  res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end('Trial upstream request failed');
}
