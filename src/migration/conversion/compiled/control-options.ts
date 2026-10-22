import type { CompleteControlOptions } from "./control-options-contracts.ts";
/** One bounded snapshot completion; preserve source row order, including equal rows. */
export const completeControlOptions: CompleteControlOptions = async (
  initial,
  read,
  limits = {},
  runtime = {},
) => {
  const cap = {
    maxRows: 10000,
    maxBytes: 1024 * 1024,
    pageSize: 500,
    ...limits,
  };
  if (
    Object.values(cap).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    ) ||
    cap.pageSize > 10000
  )
    throw Error("Invalid Select option limits");
  const now = runtime.now ?? Date.now;
  const schedule =
    runtime.schedule ??
    ((callback: () => void, delay: number) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
  const controller = new AbortController();
  const deadline = now() + 5000;
  let stopTimer = () => {},
    stopExternal = () => {};
  let rejectStop!: (reason: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  // Keep the stop rejection observed even if admission fails before the first page read.
  void stopped.catch(() => {});
  const stop = (message: string) => {
    controller.abort();
    rejectStop(Error(message));
  };
  try {
    if (runtime.signal?.aborted) throw Error("Select options cancelled");
    if (runtime.signal) {
      const abort = () => stop("Select options cancelled");
      runtime.signal.addEventListener("abort", abort, { once: true });
      stopExternal = () => runtime.signal!.removeEventListener("abort", abort);
    }
    stopTimer = schedule(() => stop("Select options timed out"), 5000);
    let table = initial,
      rows = [...initial.rows],
      bytes = new TextEncoder().encode(JSON.stringify(initial)).byteLength;
    for (
      let pages = 0;
      table.totalRows !== undefined
        ? rows.length < table.totalRows
        : table.truncated;
      pages++
    ) {
      if (controller.signal.aborted) throw Error("Select options cancelled");
      if (now() >= deadline) throw Error("Select options timed out");
      if (pages > 20 || rows.length >= cap.maxRows || bytes > cap.maxBytes)
        throw Error("Select options exceed the supported limit");
      table = await Promise.race([
        read(rows.length, cap.pageSize, controller.signal),
        stopped,
      ]);
      if (controller.signal.aborted) throw Error("Select options cancelled");
      if (now() >= deadline) throw Error("Select options timed out");
      if (
        !table ||
        JSON.stringify(table.columns) !== JSON.stringify(initial.columns) ||
        !Array.isArray(table.rows) ||
        !table.rows.length ||
        table.totalRows !== initial.totalRows
      )
        throw Error("Select option snapshot changed");
      rows.push(...table.rows);
      bytes += new TextEncoder().encode(JSON.stringify(table)).byteLength;
    }
    if (
      rows.length > cap.maxRows ||
      bytes > cap.maxBytes ||
      (initial.totalRows !== undefined && rows.length !== initial.totalRows)
    )
      throw Error("Select options exceed the supported limit");
    return { ...initial, rows, truncated: false, totalRows: rows.length };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    stopTimer();
    stopExternal();
  }
};
