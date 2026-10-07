import { describe, expect, it } from 'vitest';
import { readModel } from '../src/model.mjs';
const frame = (delta: object, extra = '') => `data: ${JSON.stringify({ id: extra, choices: [{ delta }] })}\n\n`;
const tail = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const response = (chunks: string[]) => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }));
describe('bounded model stream output', () => {
  it('accepts useful output below the budget when repeated SSE metadata exceeds 1 MiB', async () => {
    const chunks = Array.from({ length: 2300 }, () => frame({ content: 'x' }, 'm'.repeat(512)));
    expect(chunks.reduce((size, chunk) => size + chunk.length, 0)).toBeGreaterThan(1024 * 1024);
    const message = await readModel(response([...chunks, tail]));
    expect(message.content).toEqual([{ type: 'text', text: 'x'.repeat(2300) }]);
  });
  it('refuses decoded text above the output budget', async () => {
    await expect(readModel(response([frame({ content: 'x'.repeat(65) }), tail]), 64)).rejects.toThrow('response_limit');
  });
  it('counts tool arguments toward the same output budget', async () => {
    await expect(readModel(response([frame({ tool_calls: [{ index: 0, id: 'a', function: { name: 'tool', arguments: 'x'.repeat(65) } }] }), tail]), 64)).rejects.toThrow('response_limit');
  });
  it('retains a finite wire budget for streams with no useful output', async () => {
    await expect(readModel(response([frame({}, 'x'.repeat(520)), tail]), 64)).rejects.toThrow('response_limit');
  });
  it('keeps UTF-8 decoding correct across byte boundaries and counts UTF-8 output bytes', async () => {
    const bytes = new TextEncoder().encode(frame({ content: '🙂' }) + tail);
    const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    const message = await readModel(new Response(stream));
    expect(message.content).toEqual([{ type: 'text', text: '🙂' }]);
    await expect(readModel(response([frame({ content: '🙂'.repeat(17) }), tail]), 64)).rejects.toThrow('response_limit');
  });
  it('assembles split tool arguments and honors CRLF frames', async () => {
    const chunks = [frame({ tool_calls: [{ index: 0, id: 'call', function: { name: 'lookup', arguments: '{"value":' } }] }), frame({ tool_calls: [{ index: 0, function: { arguments: '7}' } }] }), tail].map(chunk => chunk.replaceAll('\n', '\r\n'));
    const message = await readModel(response(chunks));
    expect(message.content).toEqual([{ type: 'toolCall', id: 'call', name: 'lookup', arguments: { value: 7 } }]);
  });
  it('does not accept an incomplete model response', async () => {
    await expect(readModel(response([frame({ content: 'partial' })]))).rejects.toThrow('stream_truncated');
  });
});
