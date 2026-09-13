/** Shared, dependency-free shell for proxy consent and CLI callback pages.
 * bodyHtml is trusted server-authored markup; callers escape interpolated data.
 * Each transport owns its status and security headers.
 */
export function renderConnectionPage(title: string, bodyHtml: string): string {
  const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapedTitle}</title><style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background-color: #0b0e11; color: #e6edf3; font-family: var(--font-mono, ui-monospace), 'SF Mono', Menlo, monospace; font-size: 14px;
         background-image: radial-gradient(circle, #232c37 1px, transparent 1px); background-size: 26px 26px; }
  main { width: min(26rem, calc(100vw - 3rem)); background: #10151b; border: 1px solid #202832; border-radius: 8px; padding: 1.75rem; box-shadow: 0 18px 50px -20px rgba(0,0,0,0.75); }
  .brand { display: flex; align-items: center; gap: 0.5rem; font-size: 0.7rem; letter-spacing: 0.14em; text-transform: uppercase; color: #4d5665; margin-bottom: 1.25rem; }
  .brand::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #3fe77b; box-shadow: 0 0 0 3px rgba(63,231,123,0.16); }
  h1 { font-size: 1rem; margin: 0 0 0.5rem; letter-spacing: -0.01em; }
  p { font-size: 0.8rem; color: #7d8590; line-height: 1.6; margin: 0.5rem 0 1.25rem; }
  p strong { color: #e6edf3; font-weight: 600; }
  button { width: 100%; padding: 0.75rem 1rem; border-radius: 6px; border: 1px solid #3fe77b; background: #146c3e; color: #ffffff; font: inherit; font-weight: 600; letter-spacing: 0.02em; cursor: pointer; }
  button:hover { background: #1a8a4f; }
  .alt { margin: 1.25rem 0 0; font-size: 0.75rem; color: #7d8590; text-align: center; line-height: 1.6; }
  .err { color: #f85149; font-size: 0.85rem; }
</style></head><body><main><div class="brand">artifactbin</div>${bodyHtml}</main></body></html>`;
}
