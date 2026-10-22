import { sameViewerRoster } from "./viewer-roster.ts";
import { acknowledge, mergeComments } from "../model.ts";
import { jsonCopy } from "../json.ts";
import type { PlatformOperation } from "./platform-contracts.ts";
import type {
  CollaborationSession,
  CollaborationSessionOptions,
  OperationResults,
  SessionStatus,
  SessionTransport,
} from "./collaboration-session-contracts.ts";
class ObsoleteSession extends Error {
  constructor() {
    super("Collaboration session suspended or obsolete");
  }
}
/** Owns publication races and durable comment reconciliation; knows nothing about DOM or credentials. */
export function createCollaborationSession(
  options: CollaborationSessionOptions,
): CollaborationSession {
  const { gate } = options;
  const clock = options.clock ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: unknown) =>
      clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  let transport: SessionTransport | null = null,
    connection: ReturnType<SessionTransport["connect"]> | null = null;
  let generation = 0,
    connectionId = 0,
    profileSequence = 0,
    disposed = false;
  let status: SessionStatus = {
    mode: gate.active ? "active" : "suspended",
    sync: "disconnected",
    access: "pending",
    permissions: null,
    viewers: [],
    message: "",
  };
  type Drain = {
    again: boolean;
    promise: Promise<void>;
    generation: number;
    epoch: number;
  };
  let drain: Drain | null = null;
  const controllers = new Set<AbortController>();
  const valid = (g: number, e: number) =>
    !disposed && gate.accepts(e) && generation === g;
  function emit(patch: Partial<SessionStatus> = {}) {
    status = { ...status, ...patch };
    try {
      options.onChange?.(jsonCopy(status));
    } catch {
      /* Observers cannot own transport cleanup or the synchronization state machine. */
    }
  }
  function cancelWork() {
    generation++;
    profileSequence++;
    for (const c of controllers) c.abort();
    controllers.clear();
    drain = null;
  }
  function closeLive() {
    connectionId++;
    const old = connection;
    connection = null;
    try {
      old?.close();
    } catch {
      /* Cleanup must still invalidate requests and state. */
    }
  }
  function request<O extends PlatformOperation>(
    operation: O,
    contextRead = false,
  ): Promise<OperationResults[O["kind"]]> {
    const lifecycleAllowed = () =>
      gate.active || (contextRead && options.contextReadsAllowed?.() === true);
    const requestValid = (g: number, e: number) =>
      !disposed && generation === g && gate.epoch === e && lifecycleAllowed();
    if (!transport || disposed || !lifecycleAllowed())
      return Promise.reject(new ObsoleteSession());
    let owned: O;
    try {
      owned = jsonCopy(operation);
    } catch (error) {
      return Promise.reject(error);
    }
    const current = transport,
      g = generation,
      e = gate.epoch,
      controller = new AbortController();
    controllers.add(controller);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: unknown, value?: OperationResults[O["kind"]]) => {
        if (settled) return;
        settled = true;
        clock.clearTimeout(timer);
        controllers.delete(controller);
        controller.signal.removeEventListener("abort", aborted);
        if (error) reject(error);
        else resolve(value!);
      };
      const aborted = () => finish(new ObsoleteSession());
      controller.signal.addEventListener("abort", aborted, { once: true });
      const timer = clock.setTimeout(() => {
        finish(Error("Collaboration request timed out"));
        controller.abort();
      }, options.timeoutMs ?? 15000);
      // Calling the adapter in a microtask handles synchronous throws consistently.
      Promise.resolve()
        .then(() => {
          if (!requestValid(g, e) || controller.signal.aborted)
            throw new ObsoleteSession();
          return current.request(owned, controller.signal);
        })
        .then(
          (value) => {
            if (!requestValid(g, e)) finish(new ObsoleteSession());
            else {
              try {
                finish(null, jsonCopy(value));
              } catch (error) {
                finish(error);
              }
            }
          },
          (error) => finish(requestValid(g, e) ? error : new ObsoleteSession()),
        );
    });
  }
  async function refreshProfiles() {
    const seq = ++profileSequence,
      g = generation,
      e = gate.epoch;
    const profiles = await request({ kind: "profiles.list" });
    if (!valid(g, e) || seq !== profileSequence) return;
    options.updateState(
      (current) => ({ ...current, profiles: jsonCopy(profiles) }),
      "profiles",
    );
    emit();
  }
  function synchronize(): Promise<void> {
    if (!transport || disposed || !gate.active) return Promise.resolve();
    if (drain) {
      drain.again = true;
      return drain.promise;
    }
    const work: Drain = {
      again: false,
      promise: Promise.resolve(),
      generation,
      epoch: gate.epoch,
    };
    drain = work;
    work.promise = (async () => {
      try {
        do {
          work.again = false;
          emit({ sync: "syncing", access: "pending", message: "" });
          const permissions = await request({ kind: "permissions" });
          if (!valid(work.generation, work.epoch)) throw new ObsoleteSession();
          emit({
            permissions,
            access: permissions.read ? "allowed" : "denied",
          });
          if (options.authenticated() && permissions.comment) {
            const ids = [...options.readState().pending];
            for (const id of ids) {
              const current = options.readState(),
                comment = current.comments.find((c) => c.id === id);
              if (!comment || !current.pending.includes(id)) continue;
              const accepted = await request({
                kind: "comments.create",
                comment: jsonCopy(comment),
                snapshot: comment.appStateId
                  ? jsonCopy(current.snapshots[comment.appStateId] ?? null)
                  : null,
              });
              if (!valid(work.generation, work.epoch))
                throw new ObsoleteSession();
              if (accepted.id !== id)
                try {
                  options.onAcknowledged?.(id, accepted.id);
                } catch {
                  /* Presentation cannot block reconciliation. */
                }
              options.updateState(
                (latest) => acknowledge(latest, accepted, id),
                "comments",
              );
            }
          }
          const remote = await request({ kind: "comments.list" });
          try {
            await refreshProfiles();
          } catch (error) {
            if (!valid(work.generation, work.epoch)) throw error;
          }
          if (!valid(work.generation, work.epoch)) throw new ObsoleteSession();
          options.updateState(
            (latest) => mergeComments(latest, remote.comments),
            "comments",
          );
          emit({
            sync: options.readState().pending.length ? "pending" : "synced",
            message:
              remote.head !== options.readState().sourceRevision
                ? "A newer version of this page exists. Reload to see it."
                : "",
          });
        } while (work.again && valid(work.generation, work.epoch));
      } catch (error) {
        if (valid(work.generation, work.epoch)) {
          emit({
            sync: "error",
            access: [401, 403, 404].includes(
              (error as { status?: number })?.status ?? 0,
            )
              ? "denied"
              : "disconnected",
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      } finally {
        if (drain === work) drain = null;
      }
    })();
    return work.promise;
  }
  function restart() {
    cancelWork();
    closeLive();
    if (!transport || disposed || !gate.active) return;
    const id = connectionId,
      e = gate.epoch;
    const current = () => !disposed && gate.accepts(e) && id === connectionId;
    const live = transport.connect({
      ready() {
        queueMicrotask(() => {
          if (!current()) return;
          cancelWork();
          try {
            options.onReady?.();
          } catch {}
          void synchronize().catch(() => {});
        });
      },
      viewers(value) {
        if (!current()) return;
        const changed = !sameViewerRoster(status.viewers, value);
        emit({ viewers: jsonCopy(value) });
        if (changed) void refreshProfiles().catch(() => {});
      },
      changed() {
        if (current()) {
          try { options.onInvalidated?.(); } catch {}
          void synchronize().catch(() => {});
        }
      },
      status(value, error) {
        if (!current()) return;
        if (value !== "live") emit({ viewers: [] });
        if (value === "connecting" || value === "reconnecting") {
          cancelWork();
          emit({
            sync: "disconnected",
            access: value === "connecting" ? "pending" : "disconnected",
            message: "Connecting for live updates…",
          });
        }
        if (value === "error") {
          try { options.onInvalidated?.(); } catch {}
          cancelWork();
          emit({
            sync: "error",
            access: "disconnected",
            message: error ?? "Connection failed",
          });
        }
      },
    });
    if (current()) connection = live;
    else live.close();
  }
  return {
    getStatus: () => jsonCopy(status),
    attach(value) {
      if (disposed) throw new ObsoleteSession();
      transport = value;
      status={...status,access:"pending"};
      restart();
    },
    restart,
    synchronize,
    request: (operation) => request(operation),
    readContext(operation) {
      if (
        operation.kind !== "context.get" &&
        operation.kind !== "presence.capture"
      )
        return Promise.reject(Error("Invalid context read operation"));
      return request(operation, true);
    },
    refreshProfiles,
    async resolveComment(id, revision, resolved = true) {
      const g = generation,
        e = gate.epoch;
      const accepted = await request({
        kind: "comments.resolve",
        id,
        revision,
        resolved,
      });
      if (!valid(g, e)) throw new ObsoleteSession();
      options.updateState(
        (latest) => ({
          ...latest,
          comments: latest.comments.map((c) =>
            c.id === id ? { ...c, ...accepted } : c,
          ),
        }),
        "comments",
      );
      emit();
    },
    publishPresence(presence) {
      if (!disposed && gate.active) connection?.send(jsonCopy(presence));
    },
    publishCursor(cursor) {
      if (!disposed && gate.active) connection?.cursor?.(jsonCopy(cursor));
    },
    invalidate: cancelWork,
    suspend() {
      if (disposed) return;
      gate.suspend();
      cancelWork();
      closeLive();
      emit({
        mode: "suspended",
        access: "denied",
        sync: "disconnected",
        viewers: [],
        message: "",
      });
    },
    resume() {
      if (disposed) return;
      gate.resume();
      emit({ mode: "active", message: "" });
      restart();
    },
    disconnect() {
      if (disposed) return;
      cancelWork();
      closeLive();
      transport = null;
      emit({
        sync: "disconnected",
        access: "disconnected",
        permissions: null,
        viewers: [],
        message: "",
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gate.suspend();
      cancelWork();
      closeLive();
      transport = null;
      emit({
        mode: "disposed",
        access: "disposed",
        sync: "disconnected",
        viewers: [],
        message: "",
      });
    },
  };
}
