/** Bounded first-party page fetch. Does not mutate credentials or infer identity. */
import {appFetch} from './api-origin';
export class PageRequestError extends Error {
  constructor(readonly status: number) {super('Could not load this page. Please retry.');}
}
export async function pageJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new Error('Request cancelled.')); };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, {once:true});
    timer = setTimeout(() => { controller.abort(); reject(new Error('The server is taking too long. Please retry.')); }, 15_000);
  });
  try {
    return await Promise.race([deadline, appFetch(path, {credentials:'same-origin', signal:controller.signal}).then(async response => {
      if (!response.ok) throw new PageRequestError(response.status);
      return response.json() as Promise<T>;
    })]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
