/** JSDOM has no layout. Install per file: the islands module graph is shared. */
export function installEditorGeometry(): () => void {
  const targets = [
    [document, 'execCommand', () => false],
    [Range.prototype, 'getClientRects', () => []],
    [Range.prototype, 'getBoundingClientRect', () => new DOMRect()],
  ] as const;
  const originals = targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
  targets.forEach(([target, key, value]) => Object.defineProperty(target, key, { configurable: true, value }));
  return () => targets.forEach(([target, key], index) => {
    const original = originals[index];
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}
