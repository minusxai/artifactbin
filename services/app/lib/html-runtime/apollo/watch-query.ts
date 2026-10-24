import type { HtmlJsonObject as AfJsonObject } from "@artifactbin/contracts";
import type {
  ObservableQuery,
  QueryResult,
  StatePort,
} from "./apollo-contracts";
export interface QueryWatchOptions {
  clearOnRefresh?:boolean;
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
        pending = !!options.remote,
        dirty = false,
        generation = 0;
      let snapshot: QueryResult = { data: options.empty };
      let last = options.signature(options.state.read());
      let stopState = () => {},
        stopRemote = () => {};
      const stopSafely = (stop: () => void) => {try {stop();} catch {/* Cleanup failures must not escape notifications or interrupt other owners. */}};
      const close = () => {
        if (!active) return;
        active = false;
        generation++;
        stopSafely(stopState);
        stopSafely(stopRemote);
        release?.();
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
          ...(options.remote?{loading:pending}:{}),
          data: {
            ...options.local(options.state.read()),
            ...snapshot.data,
          } as T,
        });
      };
      const refresh = () => {
        if (!active || !options.remote) return;
        generation++;
        const wasPending=pending;pending=true;
        if(options.clearOnRefresh){snapshot={data:options.empty};publish();}else if(!wasPending)publish();
        if(!active)return;
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
              pending=false;
              publish();
            }
          } finally {
            running = false;
          }
        })();
      };
      try {
        const stateCleanup = options.state.subscribe((document) => {
          const key = options.signature(document);
          if (key !== last) {
            last = key;
            publish();
          }
        });
        if(active)stopState=stateCleanup;else stopSafely(stateCleanup);
        if(active){
          const remoteCleanup=options.remote?.subscribe(refresh) ?? (() => {});
          if(active)stopRemote=remoteCleanup;else stopSafely(remoteCleanup);
        }
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
