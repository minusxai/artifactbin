/**
 * The isolated jsdom project (`ui`) runs two kinds of file: the engine/kit tests, which take the
 * polyfills in vitest.setup.ui.ts, and the Solid tests that mock modules (moved out of the shared
 * `islands` graph, see vitest.config.ts), which run without them exactly as they do in `islands`.
 */
import { installEditorGeometry } from './editor-geometry';
import { beforeAll, afterAll, expect } from 'vitest';

const file = (expect.getState().testPath ?? '').split('\\').join('/');
if (!/\/services\/app\/(?:solid|lib\/islands)\//.test(file)) await import('./vitest.setup.ui');

let restoreEditorGeometry: () => void;
beforeAll(() => { restoreEditorGeometry = installEditorGeometry(); });
afterAll(() => restoreEditorGeometry());
