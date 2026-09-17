/**
 * THE ONE SSE READER for route tests.
 *
 * Six files hand-rolled this: the same `getReader()` + `TextDecoder` + `Promise.race([read,
 * deadline])` loop, six times, with six small differences — one dropped a partial block on every
 * chunk (`buffer = ''`), one tolerated keepalives and the rest threw on them, one parsed named
 * events and the rest only `data:`, and the deadline arithmetic went negative in two of them.
 * Every one of those differences was an accident, not a decision.
 *
 * This reader keeps the partial block (a frame split across two chunks completes on the next one),
 * tolerates a keepalive comment or a non-JSON payload, and reads named events and bare `data:`
 * frames through the same parse. The stream is PERSISTENT: `next()` twice reads on from where the
 * first call stopped, which is what a test asserting "and then the write arrives" needs.
 */

/** One SSE block: its `event:` name (`message` when unnamed) and its parsed `data:` payload. */
export interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface SseStream {
  /** The next `count` events, or fewer if the budget runs out. Never rejects on a slow stream. */
  next(count: number, budgetMs?: number): Promise<SseEvent[]>;
  /** The next `count` payloads, for the tests that only care what the frames said. */
  frames(count: number, budgetMs?: number): Promise<Record<string, unknown>[]>;
  /** Release the reader. Idempotent; safe to skip, since each call stops at its budget. */
  close(): void;
}

const DEFAULT_BUDGET_MS = 3000;

export function sseStream(body: ReadableStream<Uint8Array>): SseStream {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let closed = false;

  const next = async (count: number, budgetMs = DEFAULT_BUDGET_MS): Promise<SseEvent[]> => {
    const out: SseEvent[] = [];
    const deadline = Date.now() + budgetMs;
    const drain = () => {
      const blocks = buffer.split('\n\n');
      // The last piece may be half a block; keep it for the next chunk.
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        let event = 'message';
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        // A keepalive comment carries no data, and a non-JSON payload is not a frame.
        if (!data) continue;
        try { out.push({ event, data: JSON.parse(data) }); } catch { /* keepalive or partial */ }
      }
    };
    drain();
    while (out.length < count && Date.now() < deadline && !closed) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), Math.max(1, deadline - Date.now()))),
      ]);
      if (chunk.done || !chunk.value) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      drain();
    }
    return out;
  };

  return {
    next,
    frames: async (count, budgetMs) => (await next(count, budgetMs)).map((event) => event.data),
    close: () => { closed = true; void reader.cancel().catch(() => {}); },
  };
}

/** The whole stream in one call, for a test that reads once and is done. */
export const readFrames = (body: ReadableStream<Uint8Array>, count: number, budgetMs?: number) =>
  sseStream(body).frames(count, budgetMs);

/** Same, keeping each block's `event:` name. */
export const readEvents = (body: ReadableStream<Uint8Array>, count: number, budgetMs?: number) =>
  sseStream(body).next(count, budgetMs);
