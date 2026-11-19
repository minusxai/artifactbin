**Important CI rules**

1. Pull-request (PR) CI finishes under 60 seconds, ideally 40.
2. All of main's CI finishes within 6 minutes, ideally 4.
3. Going over the hard limit (60 seconds, 6 minutes) fails the run. The clock starts when the first job starts running, not while it waits for a runner.
4. Timing-related flakiness in main or PR CI must be fixed:
   - a. In PR CI, a test that takes too long moves to main. If it is critical, redesign it or fit its critical parts within the 40-second budget.
   - b. In main CI, a test that takes too long moves to the 24-hour nightly. If it is critical, redesign it or fit its critical parts within the 4-minute budget.
5. Flakiness that is not about timing, in main or PR CI, is fixed permanently or the test is removed. Never hide flakiness with an automatic retry.
6. A test that still fails often in main CI is redesigned, or its critical or frequently failing parts move to PR CI within the 40-second budget. This rule wins over 4a: a test does not bounce back to main.
7. A red nightly blocks nothing, but it is reported and fixed or removed within a day.
8. Main CI is batched, so repeated merges don't trigger multiple runs. One batch runs at a time and is never cancelled or restarted. A failed batch states exactly what failed and which commits it covers, so the breaking commit is easy to find. This also means only one deploy to production happens at a time.
9. When possible, a module's tests run only when that module, or a module it depends on, changes. End-to-end tests are the exception: they run on every change, so they are kept few and deep (test multiple things) and light.
