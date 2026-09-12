/**
 * ONE verdict dialect for every gate.
 *
 * The gates grew two incompatible collectors — `check(ok, label)`, which pushed
 * to a `failures` array and returned nothing, and `ok(condition, label)`, which
 * buffered a line and RETURNED the condition so the caller could branch on it.
 * Forty-odd copies of the two meant a reader had to know which file they were
 * in before they could read a verdict, and a gate that mixed them silently
 * inverted the branches that tested the return value.
 *
 * So there is one: a callable that prints the verdict AS IT HAPPENS (a gate
 * that dies mid-run must still show what it had already proved), records the
 * failures, and returns the boolean.
 *
 *   const check = createChecker('layout-shift');
 *   if (!check(await page.isVisible('#rail'), 'the rail is served')) …
 *   check.note('measured 190px');
 *   check.done();   // exits 0 with a count, or 1 naming every failure
 */

/**
 * @param {string} subject  the gate's name, for the closing line
 * @returns {((condition: unknown, label: string) => boolean) & {
 *   note: (label: string) => void, failures: string[], passed: number, done: () => never }}
 */
export function createChecker(subject) {
  const failures = [];
  let passed = 0;

  const check = (condition, label) => {
    const pass = Boolean(condition);
    if (pass) passed += 1; else failures.push(label);
    console.log(`${pass ? '  ok ' : 'FAIL '} ${label}`);
    return pass;
  };

  /** An observation that is evidence rather than a verdict — printed, never counted. */
  check.note = (label) => { console.log(`  ·   ${label}`); };
  check.failures = failures;

  /** The gate's verdict: exit code 1 naming every failure, or 0 with the count. */
  check.done = () => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} ${subject} check(s) failed:\n - ${failures.join('\n - ')}`);
      process.exit(1);
    }
    console.log(`\nall ${passed} ${subject} checks passed`);
    process.exit(0);
  };

  Object.defineProperty(check, 'passed', { get: () => passed });
  return check;
}
