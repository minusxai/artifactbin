/**
 * EVERY TEST THAT LAUNCHES CHROMIUM RUNS IN `integration`, NEVER IN `node`. The node shards install no Chromium,
 * so a launching test there passes locally and fails only on main's full `ci` (render-lifecycle.test.ts did).
 * This reads the test files and the resolved vitest.config.ts projects, so `pr fast` catches it first.
 */
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chromiumTests, launchesChromium } from '../lib/chromium-tests.mjs';
import config from '../../vitest.config.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const project = (name) => config.test.projects.find((entry) => entry.test?.name === name).test;

describe('Chromium-launching tests', () => {
  it('are recognised by an import of the in-process renderer or a chromium.launch call, not by mentions', () => {
    expect(launchesChromium("import { createBrowser } from '@artifactbin/browser/local';")).toBe(true);
    expect(launchesChromium("import {\n  createBrowser,\n} from '@artifactbin/browser/local';")).toBe(true);
    // Assembled, so this file's own source is not a launch.
    expect(launchesChromium("const {chromium}=await import('playwright');const browser=await chromium" + ".launch();")).toBe(true);
    expect(launchesChromium("import { request } from 'playwright';")).toBe(false);
    expect(launchesChromium("const FORBIDDEN = ['playwright', '@artifactbin/browser/local'];")).toBe(false);
    expect(launchesChromium("/**\n * prefer chromium" + ".connect() over chromium" + ".launch() here\n */\n// or chromium" + ".launch()")).toBe(false);
  });

  it('run in the integration project and are excluded from node', () => {
    const node = project('node'), integration = project('integration');
    const launching = chromiumTests(root, node.include);
    expect(launching).toEqual(expect.arrayContaining([
      'services/browser/__tests__/contract.test.ts',
      'services/browser/__tests__/internal-assets.test.ts',
      'services/browser/__tests__/render-lifecycle.test.ts',
      'services/browser/__tests__/session-pages.test.ts',
    ]));
    for (const file of launching) {
      expect(node.exclude, file).toContain(file);
      expect(integration.include, file).toContain(file);
    }
  });
});
