/**
 * THE READER STORED MERMAID DRAWINGS ARE MADE FOR (services/app lib/mermaid-images/match):
 * Blink on macOS or Windows, which lays text out at the font's unhinted,
 * fractional advances. The harvest measures that way on any OS (services/browser
 * launches it with `--font-render-hinting=none`), and the server offers stored
 * drawings only to such a reader, by its user agent. A gate or lab on a Linux
 * runner stands in for that reader by launching Chromium unhinted and naming a
 * macOS user agent — on macOS both are what it already is.
 *
 * A Linux reader's Chromium hints text (whole-pixel advances): the server gives
 * it the engine's page, exactly as before stored drawings existed.
 */
export const STORED_DRAWING_READER = Object.freeze({
  args: ['--font-render-hinting=none'],
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
export const LINUX_READER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * A Chromium that reads as STORED_DRAWING_READER: every page and context it
 * opens names that user agent unless the caller names another.
 */
export async function launchStoredDrawingReader(chromium, options = {}) {
  const browser = await chromium.launch({ ...options, args: [...(options.args ?? []), ...STORED_DRAWING_READER.args] });
  const withAgent = (opts = {}) => ({ userAgent: STORED_DRAWING_READER.userAgent, ...opts });
  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newPage') return (opts) => target.newPage(withAgent(opts));
      if (prop === 'newContext') return (opts) => target.newContext(withAgent(opts));
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
