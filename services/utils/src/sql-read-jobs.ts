import type {
  RunInput,
  SqlReadExecution,
  SqlReadJobKey,
  SqlReadJobReceipt,
  SqlReadJobs,
} from "@artifactbin/contracts";
interface Options {
  now?: () => number;
  leaseMs?: number;
  drainMs?: number;
  pollMs?: number;
  id?: string;
}
/** One immutable private read request; HTTP failure is reconciled, never interpreted as drain. */
export function sqlReadExecution(
  jobs: SqlReadJobs,
  input: RunInput,
  options: Options = {},
): SqlReadExecution {
  const snapshot = structuredClone(input),
    now = options.now ?? Date.now;
  let cancelled = false,
    wake: (() => void) | undefined;
  let drainResolve!: () => void, drainReject!: (error: Error) => void;
  const drained = new Promise<void>((resolve, reject) => {
    drainResolve = resolve;
    drainReject = reject;
  });
  drained.catch(() => {});
  const result = (async () => {
    let key: SqlReadJobKey | undefined,
      attempted = false,
      confirmed = false;
    try {
      const session = await jobs.open();
      if (
        !session ||
        typeof session.serverId !== "string" ||
        !session.serverId ||
        !Number.isSafeInteger(session.now)
      )
        throw Error("sql_read_protocol_unavailable");
      const lease = Math.min(20000, Math.max(1, options.leaseMs ?? 20000)),
        started = now();
      key = {
        id: options.id ?? crypto.randomUUID(),
        serverId: session.serverId,
        deadline: session.now + lease,
      };
      let action: "submit" | "status" = "submit";
      while (now() <= started + lease + (options.drainMs ?? 10000)) {
        if (now() >= started + lease) cancelled = true;
        let receipt: SqlReadJobReceipt | undefined;
        try {
          if (cancelled) receipt = await jobs.cancel(key);
          else if (action === "submit") {
            attempted = true;
            receipt = await jobs.submit({ ...key, input: snapshot });
            action = "status";
          } else receipt = await jobs.status(key);
        } catch {
          action = "status";
        }
        if (receipt) {
          if (
            receipt.id !== key.id ||
            receipt.serverId !== key.serverId ||
            receipt.deadline !== key.deadline
          )
            throw Error("sql_read_receipt_mismatch");
          if (receipt.drained === true) {
            if (
              !["completed", "cancelled", "rejected", "failed"].includes(
                receipt.state,
              )
            )
              throw Error("sql_read_receipt_invalid");
            confirmed = true;
            drainResolve();
            if (cancelled || receipt.state === "cancelled")
              throw Error("sql_read_cancelled");
            if (receipt.state === "completed") return receipt.results;
            throw Error("sql_read_rejected");
          }
          if (receipt.state === "unknown" && !cancelled) action = "submit";
        }
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            wake = undefined;
            resolve();
          };
          const timer = setTimeout(finish, options.pollMs ?? 25);
          wake = finish;
        });
      }
      throw Error("sql_read_drain_unconfirmed");
    } finally {
      if (!confirmed) {
        if (!attempted) drainResolve();
        else drainReject(Error("sql_read_drain_unconfirmed"));
      }
    }
  })();
  result.catch(() => {});
  return {
    result,
    cancelAndDrain: async () => {
      cancelled = true;
      wake?.();
      await drained;
    },
  };
}
