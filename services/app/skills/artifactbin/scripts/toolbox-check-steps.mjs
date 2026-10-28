/**
 * Internal: check.mjs's runner for a steps file: step() labels, numbered call tracking, the 8 s
 * deadline and the message that names the call still running. Injected into inspectPage and
 * serialized into the hosted script, so it references only its own parameters.
 * Used by: toolbox-check-inspect.mjs (PARTS).
 */

/** Runs task(page, step) on the page and records steps, verified and task on evidence; throws a
 * failure that names the step call and what the page shows. */
export async function runSteps(page, hosted, task, ready, evidence) {
  // Whether the steps ran and passed; a failure's message is in error (a bare true here once read
  // as "passed").
  evidence.steps = {ran: true, passed: false};
  // step(label, fn) runs fn and records label as verified; the summary's Verified: line lists them.
  const verified = (evidence.verified = []);
  // Each step's elapsed ms, kept on evidence and named in a failure, so a slow step shows itself.
  const timings = (evidence.stepTimings = []),
    started = Date.now();
  let current = null;
  const step = async (label, fn) => {
    current = {label: String(label).slice(0, 160), at: Date.now()};
    await fn();
    timings.push({label: current.label, ms: Date.now() - current.at});
    verified.push(current.label);
    current = null;
  };
  // Keyboard focus in the page's document, so page.keyboard reaches it without a click first.
  if (hosted)
    await page
      .mainFrame()
      .locator('iframe[data-mx-document-frame]')
      .focus({timeout: 1000})
      .catch(() => {});
  await page
    .locator('html')
    .evaluate(html => html.ownerDocument.defaultView.focus(), undefined, {timeout: 1000})
    .catch(() => {});
  // Name the steps-file call that failed or was still pending, numbered so a call repeated after a
  // reload is told apart.
  const pending = new Map();
  let failed = null,
    sequence = 0,
    expired = false;
  const show = arg => {
    try {
      return typeof arg === 'function' ? String(arg) : JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  };
  const wrap = (target, label) =>
    new Proxy(target, {
      get(object, key, receiver) {
        // A module-style steps file may destructure ({page}) from its argument.
        if (key === 'page' && label === 'page') return receiver;
        const value = Reflect.get(object, key);
        if (typeof value !== 'function' || typeof key !== 'string') return value;
        return (...args) => {
          const text = `${label}.${key}(${args.map(show).join(', ')})`
              .replace(/\s+/g, ' ')
              .slice(0, 240),
            id = ++sequence,
            call = `#${id} ${text}`;
          let result = value.apply(object, args);
          // A reload or navigation replaces the document frame: wait for the new one so later
          // calls act on the page.
          if (
            label === 'page' &&
            (key === 'reload' || key === 'goto') &&
            result &&
            typeof result.then === 'function'
          )
            result = result.then(async response => {
              await ready();
              return response;
            });
          if (result && typeof result.then === 'function') {
            pending.set(id, call);
            result.then(
              () => pending.delete(id),
              () => {
                pending.delete(id);
                if (!expired) failed ??= call;
              }
            );
          } else if (
            result &&
            typeof result === 'object' &&
            /^(locator|getBy|first|last|nth|filter|frameLocator)/.test(key)
          )
            return wrap(result, text);
          return result;
        };
      }
    });
  let timer;
  try {
    evidence.task = await Promise.race([
      task(wrap(page, 'page'), step),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('Task deadline exceeded; inspect the awaited condition')),
          8000
        );
      })
    ]);
    evidence.steps.passed = true;
    evidence.stepsMs = Date.now() - started;
  } catch (error) {
    evidence.stepsMs = Date.now() - started;
    const deadline = /^Task deadline exceeded/.test(error.message);
    expired = true;
    const latest = [...pending.values()].pop(),
      call = deadline ? (latest ?? failed) : (failed ?? latest);
    // At the deadline, say what the page shows: its live status regions and the start of its
    // visible text.
    let shows = '';
    if (deadline) {
      const seen = await Promise.race([
        page
          .locator('html')
          .evaluate(
            html => {
              const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
              const doc = html.ownerDocument;
              return {
                status: [...doc.querySelectorAll('#status,[role=status],[role=alert],[aria-live]')]
                  .map(node => tidy(node.textContent).slice(0, 120))
                  .filter(Boolean)
                  .slice(0, 3),
                text: tidy(doc.body?.innerText).slice(0, 200)
              };
            },
            undefined,
            {timeout: 1000}
          )
          .catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 1000))
      ]);
      if (seen)
        shows =
          (seen.status.length
            ? `; status: ${seen.status.map(value => JSON.stringify(value)).join(', ')}`
            : '') + `; page text: ${JSON.stringify(seen.text)}`;
    }
    // A timed-out role lookup usually missed on the name.
    const hint =
      /Timeout/.test(error.message) && /getByRole\(/.test(call ?? '')
        ? '; hint: accessible names include CSS ::before/::after text, so click script-made ' +
          'controls by [data-af-id="…"] or a regex name'
        : '';
    // Where the time went: finished steps, then the one still running (or code outside a step).
    const spent =
      '; step timings: ' +
      [
        ...timings.map(t => `${JSON.stringify(t.label)} ${t.ms} ms`),
        current
          ? `${JSON.stringify(current.label)} unfinished after ${Date.now() - current.at} ms`
          : `outside a step at ${Date.now() - started} ms`
      ].join(', ');
    throw Error(`${error.message}${call ? ` (step call ${call})` : ''}${shows}${spent}${hint}`);
  } finally {
    clearTimeout(timer);
  }
}
