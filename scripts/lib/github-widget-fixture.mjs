// Keep the production SVG/hydration path; only replace first-party metadata.
export async function githubWidgetFixture(context) {
  await context.route('**/api/external/github', route => route.fulfill({
    headers: { 'cache-control': 'public, max-age=60' },
    contentType: 'application/json', body: '{"stars":1234}',
  }));
  await context.route('https://buttons.github.io/**', () => { throw new Error('unexpected vendor script request'); });
  await context.route('https://api.github.com/**', () => { throw new Error('browser must use the first-party GitHub endpoint'); });
  await context.route('https://github.com/minusxai/artifactbin', route => route.fulfill({ contentType: 'text/html', body: '<h1>Repository destination</h1>' }));
}
