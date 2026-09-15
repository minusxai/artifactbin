/** One scene's optional posters share two connections and a bounded wait.
 * Each request gets 50 seconds after it starts; queued posters keep their spinner.
 * Local backgrounds, masks and robots never enter this queue.
 */
export function createPosterLoader() {
  type Job = { image: HTMLImageElement; url: string; active: boolean; timer: number; settle: () => void };
  const jobs = new Set<Job>();
  let disposed = false;
  const finish = (job: Job) => {
    jobs.delete(job);
    window.clearTimeout(job.timer);
    job.image.removeEventListener("load", job.settle);
    job.image.removeEventListener("error", job.settle);
  };
  const pump = () => {
    if (disposed) return;
    let active = [...jobs].filter(job => job.active).length;
    for (const job of jobs) {
      if (active >= 2) break;
      if (job.active) continue;
      job.active = true;
      active++;
      job.timer = window.setTimeout(() => {
        finish(job);
        job.image.removeAttribute("src");
        job.image.dispatchEvent(new Event("error"));
        pump();
      }, 50_000);
      try { job.image.src = job.url; }
      catch (error) { finish(job); throw error; }
    }
  };
  return {
    load(image: HTMLImageElement, url: string) {
      if (disposed) return;
      const job: Job = { image, url, active: false, timer: 0, settle: () => { finish(job); pump(); } };
      jobs.add(job);
      image.addEventListener("load", job.settle);
      image.addEventListener("error", job.settle);
      pump();
    },
    dispose() {
      disposed = true;
      for (const job of jobs) { finish(job); job.image.removeAttribute("src"); }
    },
  };
}
