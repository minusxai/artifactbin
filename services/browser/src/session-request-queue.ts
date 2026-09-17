/** Bounded backpressure for browser asset bursts; closing drops work not yet admitted. */
export function createSessionRequestQueue(concurrency = 16, capacity = 256) {
  let active = 0;
  let closed = false;
  const pending: { start(): void; reject(error: Error): void }[] = [];
  return {
    run(task: () => Promise<void>): Promise<void> {
      if (closed) return Promise.reject(new Error('Session closed'));
      if (active >= concurrency && pending.length >= capacity) return Promise.reject(new Error('Request queue limit exceeded'));
      return new Promise((resolve, reject) => {
        const start = () => {
          active++;
          const finish = () => {
            active--;
            if (!closed) pending.shift()?.start();
          };
          void task().then(() => { finish(); resolve(); }, error => { finish(); reject(error); });
        };
        if (active < concurrency) start();
        else pending.push({ start, reject });
      });
    },
    close() {
      closed = true;
      for (const item of pending.splice(0)) item.reject(new Error('Session closed'));
    },
  };
}
