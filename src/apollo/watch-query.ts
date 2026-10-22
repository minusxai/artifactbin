import type { AfJsonObject } from "../af-contracts.ts";
import type {
  ObservableQuery,
  QueryResult,
  StatePort,
} from "./apollo-contracts.ts";
export interface QueryWatchOptions {
  state: StatePort;
  signature(document: AfJsonObject): string;
  local(document: AfJsonObject): AfJsonObject;
  empty: AfJsonObject;
  remote?: {
    subscribe(listener: () => void): () => void;
    fetch(): Promise<QueryResult>;
    acquire(): () => void;
  };
}
/** One owned request plus one dirty bit per subscriber. No timers or unbounded event queue. */
export function createQueryWatch<T>(
  options: QueryWatchOptions,
): ObservableQuery<T> {
  return {
    subscribe(next) {
      const release = options.remote?.acquire();
      let active = true,
        running = false,
        dirty = false,
        generation = 0;
      let snapshot: QueryResult = { data: options.empty };
      let last = options.signature(options.state.read());
      let stopState = () => {},
        stopRemote = () => {};
      const close = () => {
        if (!active) return;
        active = false;
        generation++;
        try {
          stopState();
        } finally {
          try {
            stopRemote();
          } finally {
            release?.();
          }
        }
      };
      const publish = (propagate = false) => {
        try {
          publishResult();
        } catch (error) {
          close();
          if (propagate) throw error;
        }
      };
      const publishResult = () => {
        if (!active) return;
        next({
          ...snapshot,
          data: {
            ...options.local(options.state.read()),
            ...snapshot.data,
          } as T,
        });
      };
      const refresh = () => {
        if (!active || !options.remote) return;
        generation++;
        dirty = true;
        if (running) return;
        running = true;
        void (async () => {
          try {
            while (active && dirty) {
              dirty = false;
              const expected = generation;
              let result: QueryResult;
              try {
                result = await options.remote!.fetch();
              } catch (error) {
                result = {
                  data: options.empty,
                  errors: [
                    {
                      message:
                        error instanceof Error ? error.message : String(error),
                    },
                  ],
                };
              }
              if (!active || generation !== expected) continue;
              snapshot = result;
              publish();
            }
          } finally {
            running = false;
          }
        })();
      };
      try {
        stopState = options.state.subscribe((document) => {
          const key = options.signature(document);
          if (key !== last) {
            last = key;
            publish();
          }
        });
        stopRemote = options.remote?.subscribe(refresh) ?? (() => {});
        publish(true);
        refresh();
      } catch (error) {
        close();
        throw error;
      }
      return {
        unsubscribe: close,
      };
    },
  };
}
