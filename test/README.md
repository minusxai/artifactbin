# Running tests

`npm test` (also `npm run test:unit`) discovers every declared in-process test. It requires Node and installed npm dependencies, and works without built assets, PostgreSQL, browsers or Docker.

Declare a capability in each Node test filename. Keep the product-module prefix and `.test.js` or `.test.ts` ending:

| Suffix              | Behavior and prerequisites                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `.unit.test.ts`     | In-process behavior with injected ports, clocks and scheduling. No external services or built assets.                     |
| `.local.test.ts`    | Real temporary files, child processes, loopback HTTP or Unix sockets. The stage builds assets for preview adapter checks. |
| `.database.test.ts` | Real isolated PostgreSQL schema and application HTTP/CLI integration.                                                     |
| `.browser.test.ts`  | Actual browser DOM or authenticated browser integration. The stage requires PostgreSQL and all three installed engines.   |
| `.isolate.test.ts`  | Actual Docker/workerd compilation or execution, including database-backed deployment, connectors and hosted backend calls in Chromium. |

The same suffixes apply to JavaScript tests. Names describe exercised capabilities, not imports: a backend test using a fake host can be unit or local; a library test launching Chromium and using PostgreSQL is a browser test. A new unclassified `.test.js` or `.test.ts` fails discovery. New module directories are discovered recursively.


Use `npm run test:local`, `test:database`, `test:browser` or `test:isolate` for a stage; `test:integration` runs every non-unit test. Stage commands build assets and the backend image when required. Database, browser and isolate stages need a disposable PostgreSQL database through `PAGEGI_DATABASE_URL` (or the documented local test endpoint); install browser engines with `npx playwright install --with-deps chromium firefox webkit`. Missing prerequisites fail with setup guidance; integration tests are never silently skipped.

Every stage includes the v2 acceptance tests in `test/v2/`, which are read straight from the author skill; `npm run test:v2:<stage>` (or `test:v2:all`) runs only those. Browser journeys (`*-journey.browser.test.js`) are ordinary files in the browser stage. `npm run check` is validation followed by `npm run test:all-node`, every stage.
