/**
 * ONE SERVER-SENT EVENTS STREAM, framed in one place: the readable side a route hands back, and `send` for each
 * frame (its data, an optional event name, and an optional `id:` the reader resumes from). Writes keep their order.
 * `send` answers false once the reader has gone instead of throwing; `gone` settles when the reader cancels.
 */
export interface SseChannel {
  readonly readable: ReadableStream<Uint8Array>;
  /** One frame; no `event` is the default `message`. */
  send(data: string, frame?: { event?: string; id?: string }): Promise<boolean>;
  /** Text already framed (the keepalive, lib/http liveKeepaliveFrame). */
  sendFramed(text: string): Promise<boolean>;
  /** Rejects when the reader cancels the response, even while the request itself stays live. */
  readonly gone: Promise<unknown>;
  close(): Promise<void>;
}

export function sseChannel(): SseChannel {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const sendFramed = (text: string) => writer.write(encoder.encode(text)).then(() => true, () => false);
  return {
    readable,
    send: (data, frame = {}) => sendFramed(`${frame.id ? `id: ${frame.id}\n` : ''}${frame.event ? `event: ${frame.event}\n` : ''}data: ${data}\n\n`),
    sendFramed,
    gone: writer.closed,
    close: () => writer.close().catch(() => {}),
  };
}
