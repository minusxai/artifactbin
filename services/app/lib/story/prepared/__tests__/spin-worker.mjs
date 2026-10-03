// A stand-in draft-compile thread: holds its own thread for the requested time, then answers.
import { parentPort } from 'node:worker_threads';
parentPort.on('message', ({ id, input }) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(input.title));
  parentPort.postMessage(input.source === 'fail' ? { id, ok: false, error: 'draft source is incomplete' } : { id, ok: true, value: `<p>${input.source}</p>` });
});
parentPort.postMessage({ ready: true });
