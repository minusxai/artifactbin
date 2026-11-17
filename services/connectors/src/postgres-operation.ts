/** The pinned postgres.js driver resolves queries (including server errors) at ReadyForQuery.
 * Its public cancel() drops the cancellation promise; observe the internal canceller so a failed
 * cancellation transport cannot become an unhandled rejection. No SQL PID/catalog authority is needed.
 * A lost socket is not completion evidence: the pool must quarantine that operation's capacity. */
import { ConnectorFailure } from './errors';

interface DriverQuery<T> extends PromiseLike<T> {
  state?: unknown;
  canceller?: ((query: DriverQuery<T>) => Promise<void>) | null;
}
export function trackPostgresOperation<T>(input: PromiseLike<T>, serverError: (error: unknown) => boolean) {
  const query = input as DriverQuery<T>;
  let settled = false, confirmed = false, cancelling = false;
  const result = Promise.resolve(query).then(value => {
    settled = confirmed = true;
    return value;
  }, error => {
    settled = true;
    // Before driver dispatch, no backend can be running this operation.
    confirmed = serverError(error) || query.state === null;
    throw error;
  });
  const completion = result.then(() => {}, () => {});
  return {
    result,
    get confirmed() { return confirmed; },
    async stop() {
      if (!settled && !cancelling) {
        if (typeof query.canceller !== 'function') throw new ConnectorFailure('unavailable', 'database cancellation unavailable');
        cancelling = true;
        const cancel = query.canceller;
        query.canceller = null;
        // Dispatch completion is not server completion. A failed dispatch may still be followed by
        // normal/native-timeout completion; the enclosing cleanup deadline bounds this wait.
        void Promise.resolve().then(() => cancel(query)).catch(() => {});
      }
      await completion;
      if (!confirmed) throw new ConnectorFailure('unavailable', 'database completion unconfirmed');
    },
  };
}
