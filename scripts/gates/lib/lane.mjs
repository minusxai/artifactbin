/**
 * A LANE: one run of DEPENDENT steps inside a gate, reported through the gate's checker (lib/assert.mjs).
 *
 * A journey gate runs several independent legs (an engine, a persona, a session) and each leg is a chain:
 * once its page is wrong, every later step only waits out its own timeout on that wrong page. So a step
 * that throws records its label as a FAILED check and ends its lane; the other lanes keep going and the
 * gate's verdict still names every failure. A step that passes is a passed check under the same label.
 *
 *   const { step, must, run } = lane(check, 'firefox (solid, editing)');
 *   await run(async () => {
 *     await step('the heading renders', () => expect(heading).toBeVisible());
 *     must(saved.status === 'completed', 'the session completed');   // false: fail and end the lane
 *     check(requests.length === 0, 'firefox: network requests');      // false: fail, keep going
 *   });
 */

/** Thrown to end a lane after its failure has been recorded; never reported twice. */
class LaneEnded extends Error {}

const firstLine = (error) => String(error?.message ?? error).split('\n').find((line) => line.trim()) ?? String(error);

/**
 * @param {((condition: unknown, label: string) => boolean)} check  the gate's checker
 * @param {string} name  the lane's name, prefixed to every step label
 */
export function lane(check, name) {
  const label = (text) => `${name}: ${text}`;
  /** Run `fn`; a throw fails `text` and ends the lane. Returns `fn`'s value. */
  const step = async (text, fn) => {
    let value;
    try {
      value = await fn();
    } catch (error) {
      if (error instanceof LaneEnded) throw error;
      check(false, `${label(text)} — ${firstLine(error)}`);
      throw new LaneEnded(text);
    }
    check(true, label(text));
    return value;
  };
  /** A verdict the rest of the lane depends on: false fails it and ends the lane. */
  const must = (condition, text) => {
    if (!check(condition, label(text))) throw new LaneEnded(text);
  };
  /** Run the lane's body; an ended lane resolves, an unexpected throw is a failure of its own. */
  const run = async (body) => {
    try {
      await body();
    } catch (error) {
      if (!(error instanceof LaneEnded)) check(false, `${label('the lane threw')} — ${firstLine(error)}`);
    }
  };
  return { step, must, run };
}
