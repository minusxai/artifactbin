// Keep vendor responses deterministic while exercising the sandboxed iframe
// fetch and popup navigation in browser gates.
export async function githubWidgetFixture(context) {
  await context.route('https://buttons.github.io/buttons.js', route => route.fulfill({ contentType: 'application/javascript', body: `const style=document.createElement('style');style.textContent='body{background:rgb(255,255,255)}@media(prefers-color-scheme:dark){body{background:rgb(13,17,23)}}';document.head.append(style);fetch('https://api.github.com/repos/minusxai/artifactbin').then(r=>r.json()).then(d=>{const link=document.querySelector('a');const widget=document.createElement('span');widget.style.cssText='display:inline-block;width:112px;height:28px;font:12px/28px sans-serif';link.replaceWith(widget);widget.append(link);link.textContent='Star '+d.stargazers_count;link.target='_blank';link.setAttribute('aria-label',d.stargazers_count+' stargazers on GitHub')})` }));
  await context.route('https://api.github.com/repos/minusxai/artifactbin', route => route.fulfill({ headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"stargazers_count":1234}' }));
  await context.route('https://github.com/minusxai/artifactbin', route => route.fulfill({ contentType: 'text/html', body: '<h1>Repository destination</h1>' }));
}
