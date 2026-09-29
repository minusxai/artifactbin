// Shared author document for the real compiler and the one-tree experiment.
const kb = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(300);

export function largeFixture() {
  const panels = [[], [], []];
  for (let i = 0; i < 1_100; i++) {
    const panel = Math.floor(i * 3 / 1_100);
    const id = i === 1_099 ? 'large-last-row' : `large-row-${i}`;
    panels[panel].push(`<div id="${id}"><p>row ${i} ${kb}</p><Badge>Badge ${i}</Badge></div>`);
  }
  const panelRows = panels.map(rows => rows.join(''));
  const names = ['zero', 'one', 'two'];
  const source = `<Tabs defaultValue="zero"><TabsList>${names.map((name, i) => `<TabsTrigger value="${name}">Tab ${i}</TabsTrigger>`).join('')}</TabsList>${names.map((name, i) => `<TabsContent value="${name}">${panelRows[i]}${i === 1 ? '<Switch label="Switch" />' : ''}</TabsContent>`).join('')}</Tabs>`;
  return { source, panelRows, rowCount: 1_100 };
}
