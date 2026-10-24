import { createHash, randomUUID } from "node:crypto";
import type {
  SqlReadExecution,
  SqlReadJobs,
  SqlReadJobKey,
  SqlReadJobReceipt,
  SqlReadJobSubmission,
  RunInput,
} from "@artifactbin/contracts";
interface Options {
  serverId?: string;
  now?: () => number;
  schedule?: (ms: number, callback: () => void) => () => void;
  maxActive?: number;
  maxEntries?: number;
  maxResultBytes?: number;
  maxRetainedBytes?: number;
  retentionMs?: number;
}
interface Entry {
  key: SqlReadJobKey;
  digest: string | null;
  receipt: SqlReadJobReceipt;
  handle?: SqlReadExecution;
  cancel?: Promise<void>;
  stop?: () => void;
  terminalAt?: number;
  bytes?: number;
  cancelled: boolean;
}
/** Process-owned read receipts, not a general job service. A missing receipt NEVER attests drain. */
export function createReadJobs(
  start: ((input: RunInput) => SqlReadExecution) | undefined,
  options: Options = {},
): SqlReadJobs & { close(): Promise<void> } {
  const serverId = options.serverId ?? randomUUID();
  const entries = new Map<string, Entry>();
  let active = 0,
    closed = false,
    observed = 0,
    retainedBytes = 0;
  const now = () =>
    (observed = Math.max(observed, (options.now ?? Date.now)()));
  const schedule =
    options.schedule ??
    ((ms, callback) => {
      const timer = setTimeout(callback, ms);
      timer.unref();
      return () => clearTimeout(timer);
    });
  const maxActive = options.maxActive ?? 8,
    maxEntries = options.maxEntries ?? 1024,
    retention = options.retentionMs ?? 60000;
  const keyOf = (request: SqlReadJobKey) => {
    if (
      !request ||
      typeof request.id !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(request.id) ||
      !Number.isSafeInteger(request.deadline) ||
      typeof request.serverId !== "string" ||
      !request.serverId ||
      request.serverId.length > 128
    )
      throw Error("invalid_sql_job");
    return {
      id: request.id,
      deadline: request.deadline,
      serverId: request.serverId,
    };
  };
  const sweep = () => {
    const time = now();
    for (const [id, entry] of entries)
      if (
        entry.terminalAt !== undefined &&
        time > Math.max(entry.key.deadline, entry.terminalAt) + retention
      ) {
        retainedBytes -= entry.bytes ?? 0;
        entries.delete(id);
      }
  };
  const existing = (key: SqlReadJobKey) => {
    const entry = entries.get(key.id);
    if (entry && entry.key.deadline !== key.deadline)
      throw Error("sql_job_conflict");
    return entry;
  };
  const receipt = (entry: Entry) => structuredClone(entry.receipt);
  const finish = (entry: Entry, outcome: SqlReadJobReceipt) => {
    if (entry.receipt.drained) return;
    entry.stop?.();
    entry.receipt = outcome;
    entry.terminalAt = now();
    entry.handle = undefined;
    active--;
  };
  const cancel = async (entry: Entry) => {
    if (entry.receipt.drained) return;
    entry.cancelled = true;
    entry.cancel ??= (async () => {
      await entry.handle!.cancelAndDrain();
      finish(entry, {
        ...entry.key,
        state: "cancelled",
        drained: true,
        code: "sql_read_cancelled",
      });
    })();
    await entry.cancel;
  };
  const terminal = (
    key: SqlReadJobKey,
    state: "cancelled" | "rejected",
    code: string,
  ): Entry => ({
    key,
    digest: null,
    receipt: { ...key, state, drained: true, code },
    terminalAt: now(),
    cancelled: state === "cancelled",
  });
  return {
    async open() {
      return { serverId, now: now() };
    },
    async submit(request: SqlReadJobSubmission) {
      const key = keyOf(request);
      if (key.serverId !== serverId)
        return { ...key, state: "unknown", drained: false };
      sweep();
      if (
        !request.input ||
        !Array.isArray(request.input.queries) ||
        request.input.queries.length > 64 ||
        typeof request.input.tables !== "object" ||
        !request.input.tables ||
        typeof request.input.params !== "object" ||
        !request.input.params
      )
        throw Error("invalid_sql_job");
      const encoded = JSON.stringify(request.input);
      if (Buffer.byteLength(encoded) > 8 * 1024 * 1024)
        throw Error("sql_job_input_limit");
      const hash = createHash("sha256").update(encoded).digest("hex");
      const prior = existing(key);
      if (prior) {
        if (prior.digest !== null && prior.digest !== hash)
          throw Error("sql_job_conflict");
        return receipt(prior);
      }
      if (key.deadline <= now() || key.deadline > now() + 20000)
        return {
          ...key,
          state: "rejected",
          drained: true,
          code: "sql_job_lease_invalid",
        };
      if (entries.size >= maxEntries) throw Error("sql_job_capacity");
      if (closed || !start || active >= maxActive) {
        const entry = terminal(
          key,
          "rejected",
          closed
            ? "sql_job_closed"
            : !start
              ? "sql_job_unsupported"
              : "sql_job_busy",
        );
        entry.digest = hash;
        entries.set(key.id, entry);
        return receipt(entry);
      }
      const entry: Entry = {
        key,
        digest: hash,
        receipt: { ...key, state: "running", drained: false },
        cancelled: false,
      };
      entries.set(key.id, entry);
      active++;
      try {
        entry.handle = start(structuredClone(request.input));
      } catch {
        finish(entry, {
          ...key,
          state: "failed",
          drained: true,
          code: "sql_job_start_failed",
        });
        return receipt(entry);
      }
      entry.stop = schedule(Math.max(1, key.deadline - now()), () => {
        void cancel(entry).catch(() => {});
      });
      entry.handle.result
        .then(
          (results) => {
            if (entry.cancelled) return;
            const bytes = Buffer.byteLength(JSON.stringify(results));
            if (
              bytes > (options.maxResultBytes ?? 8 * 1024 * 1024) ||
              retainedBytes + bytes >
                (options.maxRetainedBytes ?? 32 * 1024 * 1024)
            )
              finish(entry, {
                ...key,
                state: "failed",
                drained: true,
                code: "sql_job_output_limit",
              });
            else {
              entry.bytes = bytes;
              retainedBytes += bytes;
              finish(entry, {
                ...key,
                state: "completed",
                drained: true,
                results: structuredClone(results),
              });
            }
          },
          () => {
            if (!entry.cancelled)
              finish(entry, {
                ...key,
                state: "failed",
                drained: true,
                code: "sql_job_failed",
              });
          },
        )
        .catch(() => {});
      return receipt(entry);
    },
    async status(request) {
      const key = keyOf(request);
      if (key.serverId !== serverId)
        return { ...key, state: "unknown", drained: false };
      sweep();
      const entry = existing(key);
      return entry
        ? receipt(entry)
        : { ...key, state: "unknown", drained: false };
    },
    async cancel(request) {
      const key = keyOf(request);
      if (key.serverId !== serverId)
        return { ...key, state: "unknown", drained: false };
      sweep();
      const entry = existing(key);
      if (entry) {
        await cancel(entry);
        return receipt(entry);
      }
      // A cancellation tombstone closes the submit/disconnect race, including an in-flight submit packet.
      if (key.deadline <= now())
        return {
          ...key,
          state: "rejected",
          drained: true,
          code: "sql_job_lease_expired",
        };
      if (key.deadline > now() + 20000) throw Error("invalid_sql_job");
      if (entries.size >= maxEntries) throw Error("sql_job_capacity");
      const tombstone = terminal(key, "cancelled", "sql_read_cancelled");
      entries.set(key.id, tombstone);
      return receipt(tombstone);
    },
    async close() {
      closed = true;
      await Promise.all([...entries.values()].map(cancel));
    },
  };
}
