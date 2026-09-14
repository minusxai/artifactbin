// Reuse the app's existing brand artwork; no redrawn logos or remote assets.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'services/app/components/brand-icons.tsx'), 'utf8');
const out = path.join(root, 'services/app/public/landing/workshop/robots');
(async () => {
  for (const [name, component, viewBox, fill] of [
    ['claude','ClaudeCodeIcon','0 0 24 24','#D97757'],
    ['codex','CodexIcon','0 0 24 24','#7A9DFF'],
    ['pi','PiIcon','150 150 500 500','#153d75'],
  ]) {
    const section = source.split(`export function ${component}(`)[1].split('</svg>')[0];
    const inner = section.slice(section.indexOf('>') + 1)
      .replaceAll('fillRule=', 'fill-rule=').replaceAll('clipRule=', 'clip-rule=')
      .replaceAll('stopColor=', 'stop-color=');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><svg x="72" y="72" width="368" height="368" viewBox="${viewBox}" fill="${fill}" fill-rule="evenodd">${inner}</svg></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(out, `badge-${name}.png`));
  }
})();
