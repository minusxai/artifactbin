// An engine thread that starts and then never answers: what the pool's watchdog exists for.
import { parentPort } from 'node:worker_threads';
parentPort.postMessage({ ready: true });
parentPort.on('message', () => {});
