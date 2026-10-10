/**
 * The module-graph check (scripts/ci/module-graph.mjs) has to be shown to bite: each rule runs once
 * against a tiny synthetic tree that breaks it, and the real tree must stay clean.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkModuleGraph, ISLANDS_BROWSER_IMPORTERS, moduleOf, recordAllowedCycles, scanModuleGraph } from '../ci/module-graph.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'module-graph.mjs');
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'module-graph-'));
  temporary.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

const libCycle = {
  'services/app/lib/a/index.ts': "import { b } from '../b';\nexport const a = 1;\n",
  'services/app/lib/b/index.ts': "import type { A } from '@/lib/a/types';\nexport const b = 2;\n",
  'services/app/lib/a/types.ts': 'export type A = 1;\n',
};
const allowList = cycles => ({ cycles });
const ab = { modules: ['lib/a', 'lib/b'], edges: ['lib/a -> lib/b', 'lib/b -> lib/a'] };

describe('module graph', () => {
  it('maps paths to modules', () => {
    expect(moduleOf('services/app/lib/publish/x/y.ts')).toBe('lib/publish');
    expect(moduleOf('services/app/lib/runner.ts')).toBe('lib/runner');
    expect(moduleOf('services/app/solid/pages/Doc.tsx')).toBe('app/solid');
    expect(moduleOf('services/cli/src/index.ts')).toBe('pkg/cli');
    expect(moduleOf('scripts/lib/x.mjs')).toBe('scripts');
    expect(moduleOf('server.ts')).toBe('server');
  });

  it('counts type-only imports and ignores tests', () => {
    const root = tree({ ...libCycle, 'services/app/lib/b/__tests__/x.test.ts': "import '@/solid/y';\n", 'services/app/lib/b/z.test.ts': "import '@/solid/y';\n" });
    const graph = scanModuleGraph(root);
    expect([...graph.get('lib/b').keys()]).toEqual(['lib/a']);
    expect(graph.get('lib/b').get('lib/a')[0]).toEqual({ file: 'services/app/lib/b/index.ts', specifier: '@/lib/a/types' });
  });

  it('fails a library cycle that the allow-list does not record, naming the edges', () => {
    const { violations } = checkModuleGraph(scanModuleGraph(tree(libCycle)), allowList([]));
    expect(violations.join('\n')).toContain('lib/a -> lib/b');
    expect(violations.join('\n')).toContain('lib/b -> lib/a (services/app/lib/b/index.ts imports @/lib/a/types)');
  });

  it('passes a recorded cycle and fails a new back edge into it', () => {
    expect(checkModuleGraph(scanModuleGraph(tree(libCycle)), allowList([ab])).violations).toEqual([]);
    const grown = scanModuleGraph(tree({ ...libCycle, 'services/app/lib/c/index.ts': "import '../a';\n", 'services/app/lib/b/c.ts': "import '../c';\n" }));
    const { violations } = checkModuleGraph(grown, allowList([ab]));
    expect(violations.join('\n')).toMatch(/lib\/b -> lib\/c[\s\S]*lib\/c -> lib\/a/);
  });

  it('fails a stale allow-list entry so the list only shrinks', () => {
    const { violations } = checkModuleGraph(scanModuleGraph(tree({ 'services/app/lib/a/index.ts': "import '../b';\n", 'services/app/lib/b/index.ts': '' })), allowList([ab]));
    expect(violations.join('\n')).toContain('lib/a -> lib/b');
    expect(violations.join('\n')).toContain('no longer');
  });

  it('fails any cycle through an entry point or the UI, even if allow-listed', () => {
    const root = tree({ ...libCycle, 'services/app/lib/b/ui.ts': "import { Doc } from '@/solid/pages/Doc';\n", 'services/app/solid/pages/Doc.tsx': "import '@/lib/a';\nexport const Doc = 1;\n" });
    const graph = scanModuleGraph(root);
    const allowed = allowList([{ modules: ['app/solid', 'lib/a', 'lib/b'], edges: ['lib/b -> app/solid', 'app/solid -> lib/a', ...ab.edges] }]);
    const { violations } = checkModuleGraph(graph, allowed);
    expect(violations.join('\n')).toContain('app/solid');
    expect(violations.join('\n')).toContain('lib/b -> app/solid (services/app/lib/b/ui.ts imports @/solid/pages/Doc)');
    expect(() => recordAllowedCycles(graph)).toThrow(/app\/solid/);
  });

  it('fails a package that imports anything but contracts, utils or itself', () => {
    const root = tree({
      'services/auth/src/x.ts': "import { c } from '@artifactbin/contracts';\nimport { u } from '@artifactbin/utils/http';\nimport { q } from '@artifactbin/sql';\nimport './y';\n",
      'services/auth/src/y.ts': "export const y = await import('../../app/lib/publish/index.ts');\n",
      'services/cli/src/z.ts': "import '@/lib/cli-toolkit';\n",
    });
    const violations = checkModuleGraph(scanModuleGraph(root), allowList([])).violations.join('\n');
    expect(violations).toContain('pkg/auth -> pkg/sql');
    expect(violations).toContain('pkg/auth -> lib/publish');
    expect(violations).not.toMatch(/-> pkg\/(contracts|utils)/);
    expect(violations).not.toContain('pkg/cli');
  });

  describe('lib/islands entry (rule 4)', () => {
    const islands = { importers: ['services/app/solid/', 'services/app/lib/offline/solid-entry.tsx'], leaves: ['trusted-portal'] };
    const check = files => checkModuleGraph(scanModuleGraph(tree({ 'services/app/lib/islands/index.ts': '', ...files })), allowList([]), islands).violations.join('\n');

    it('passes server code through the index and listed browser code through a listed leaf', () => {
      expect(check({
        'services/app/lib/compiled-page/compiler.ts': "import { RECIPES } from '@/lib/islands';\n",
        'services/app/scripts/gen.ts': "import { FAMILIES } from '../lib/islands/index';\n",
        'services/app/solid/Popover.tsx': "import { trustedPortalOf } from '@/lib/islands/trusted-portal';\n",
        'services/app/lib/offline/solid-entry.tsx': "import '../islands/trusted-portal.ts';\n",
      })).toBe('');
    });

    it('refuses a leaf from server code, naming the rule and the import', () => {
      const violations = check({
        'services/app/solid/Popover.tsx': "import '@/lib/islands/trusted-portal';\n",
        'services/app/lib/serving/frame.ts': "import { STORY_FRAMED_ATTR } from '@/lib/islands/contract';\n",
        'services/app/lib/offline/assemble.server.ts': "import type { X } from '../islands/trusted-portal';\n",
      });
      expect(violations).toContain('ISLANDS_BROWSER_IMPORTERS, ISLANDS_BROWSER_LEAVES in scripts/ci/module-graph.mjs');
      expect(violations).toContain('services/app/lib/serving/frame.ts imports @/lib/islands/contract (server code imports @/lib/islands)');
      expect(violations).toContain('services/app/lib/offline/assemble.server.ts imports ../islands/trusted-portal (server code imports @/lib/islands)');
    });

    it('refuses an unlisted leaf and the index from browser code', () => {
      const violations = check({
        'services/app/solid/Popover.tsx': "import '@/lib/islands/trusted-portal';\nimport { placePopper } from '@/lib/islands/kit/popper';\n",
        'services/app/solid/Chart.tsx': "export const c = await import('@/lib/islands');\n",
      });
      expect(violations).toContain('services/app/solid/Popover.tsx imports @/lib/islands/kit/popper (kit/popper is not in ISLANDS_BROWSER_LEAVES)');
      expect(violations).toContain('services/app/solid/Chart.tsx imports @/lib/islands (browser-bundled code imports a leaf file, not the index)');
    });

    it('fails a listed leaf nothing imports any more, so the list only shrinks', () => {
      expect(check({ 'services/app/lib/compiled-page/compiler.ts': "import '@/lib/islands';\n" })).toMatch(/no browser-bundled code imports any more[\s\S]*trusted-portal/);
    });

    it('ignores imports inside lib/islands and lists only real browser-side importers', () => {
      expect(check({ 'services/app/solid/Popover.tsx': "import '@/lib/islands/trusted-portal';\n", 'services/app/lib/islands/kit/popper.ts': "import '../contract';\n" })).toBe('');
      expect(ISLANDS_BROWSER_IMPORTERS.filter(entry => !entry.endsWith('/'))).toEqual(expect.arrayContaining(['services/app/lib/offline/solid-entry.tsx']));
      expect(ISLANDS_BROWSER_IMPORTERS.some(entry => entry === 'services/app/lib/offline/')).toBe(false);
    });
  });

  describe('deep-module entries (rule 4, DEEP_MODULES)', () => {
    const table = { 'lib/dataflow': { entries: ['', 'server'], browserImporters: ['services/app/solid/', 'services/app/lib/offline/solid-entry.tsx'], browserLeaves: ['scalar-input'] } };
    const base = { 'services/app/lib/dataflow/index.ts': '', 'services/app/lib/dataflow/server.ts': '', 'services/app/lib/dataflow/scalar-input.ts': '', 'services/app/lib/dataflow/compile.ts': '' };
    const used = { 'services/app/lib/publish/a.ts': "import '@/lib/dataflow/server';\n", 'services/app/solid/Input.tsx': "import '@/lib/dataflow/scalar-input';\n" };
    const check = files => checkModuleGraph(scanModuleGraph(tree({ ...base, ...files })), allowList([]), undefined, table).violations.join('\n');

    it('passes an outside import of a listed entry, from server or browser-bundled code', () => {
      expect(check({
        ...used,
        'services/app/lib/serving/b.ts': "import { x } from '@/lib/dataflow';\nimport type { Y } from '../dataflow/server.ts';\n",
        'services/app/solid/Panel.tsx': "export const d = await import('@/lib/dataflow/index');\n",
        'services/app/lib/dataflow/server.ts': "import './compile';\n",
      })).toBe('');
    });

    it('refuses an outside deep import of an unlisted path, naming the file, the specifier and what to do', () => {
      const violations = check({ ...used, 'services/app/lib/serving/c.ts': "import { compile } from '@/lib/dataflow/compile';\n" });
      expect(violations).toContain('services/app/lib/serving/c.ts imports @/lib/dataflow/compile');
      expect(violations).toContain("DEEP_MODULES['lib/dataflow']");
      expect(violations).toContain('re-export the name from services/app/lib/dataflow/index.ts');
    });

    it('refuses a relative specifier that resolves to an unlisted path', () => {
      const violations = check({ ...used, 'services/app/lib/publish/d.ts': "export type C = import('../dataflow/compile.ts').C;\n" });
      expect(violations).toContain('services/app/lib/publish/d.ts imports ../dataflow/compile.ts');
    });

    it('passes a browser leaf only from a listed importer', () => {
      expect(check({ ...used, 'services/app/lib/offline/solid-entry.tsx': "import '../dataflow/scalar-input';\n" })).toBe('');
      const violations = check({ ...used, 'services/app/lib/serving/e.ts': "import { parseScalar } from '@/lib/dataflow/scalar-input';\n", 'services/app/lib/offline/compiled-boot.ts': "import '../dataflow/scalar-input';\n" });
      expect(violations).toContain('services/app/lib/serving/e.ts imports @/lib/dataflow/scalar-input');
      expect(violations).toContain('services/app/lib/offline/compiled-boot.ts imports ../dataflow/scalar-input');
    });

    it('reports a listed entry or browser leaf nothing outside imports any more, so the lists only shrink', () => {
      const violations = check({ 'services/app/lib/publish/a.ts': "import '@/lib/dataflow/server';\n" });
      expect(violations).toMatch(/lib\/dataflow[^\n]*nothing outside imports any more[^\n]*DEEP_MODULES\['lib\/dataflow'\][\s\S]*browser leaf scalar-input/);
      expect(check({ 'services/app/solid/Input.tsx': "import '@/lib/dataflow/scalar-input';\n" })).toMatch(/nothing outside imports any more[^\n]*\n  entry server$/);
      expect(violations).not.toMatch(/^ {2}entry $/m);
    });

    it('holds lib/artifacts to its index alone: any deep import, alias or relative, is refused', () => {
      const files = { 'services/app/lib/artifacts/index.ts': "export * from './store';\n", 'services/app/lib/artifacts/store.ts': '' };
      // The real DEEP_MODULES table (the default): only lib/artifacts is in this tree, so only its row applies.
      const run = extra => checkModuleGraph(scanModuleGraph(tree({ ...files, ...extra })), allowList([])).violations.join('\n');
      expect(run({
        'services/app/lib/publish/a.ts': "import { getArtifactById } from '@/lib/artifacts';\n",
        'services/app/lib/runner/b.ts': "import type { ArtifactRow } from '../artifacts';\n",
      })).toBe('');
      const violations = run({
        'services/app/lib/serving/c.ts': "import { getArtifactById } from '@/lib/artifacts/store';\n",
        'services/app/lib/runner/d.ts': "import { getArtifactById } from '../artifacts/store';\n",
      });
      expect(violations).toContain("DEEP_MODULES['lib/artifacts']");
      expect(violations).toContain('services/app/lib/serving/c.ts imports @/lib/artifacts/store');
      expect(violations).toContain('services/app/lib/runner/d.ts imports ../artifacts/store');
    });
  });

  describe('page rows as shipped (DEEP_MODULES)', () => {
    // The shipped table, unmodified: a row whose module is absent from the tree is skipped.
    const check = (module, files) => checkModuleGraph(scanModuleGraph(tree(files)), allowList([])).violations.join('\n');

    it('lib/page-styles: server code through the index, only the offline file\'s browser code through document-root', () => {
      const offline = {
        'services/app/lib/page-styles/index.ts': '', 'services/app/lib/page-styles/document-root.ts': '', 'services/app/lib/page-styles/inline-css.ts': '',
        'services/app/lib/offline/file-html.ts': "import { documentRootAttributes } from '@/lib/page-styles/document-root';\n",
        'services/app/lib/offline/solid-entry.tsx': "import '../page-styles/document-root';\n",
        'services/app/lib/publish/prepared/serve.server.ts': "import { DOMAIN_FOOTER_CSS } from '@/lib/page-styles';\n",
      };
      expect(check('lib/page-styles', offline)).toBe('');
      const refused = check('lib/page-styles', { ...offline, 'services/app/lib/publish/a.ts': "import '@/lib/page-styles/inline-css';\n", 'services/app/lib/offline/assemble.server.ts': "import '@/lib/page-styles/document-root';\n" });
      expect(refused).toContain('services/app/lib/publish/a.ts imports @/lib/page-styles/inline-css');
      expect(refused).toContain('services/app/lib/offline/assemble.server.ts imports @/lib/page-styles/document-root');
      expect(check('lib/page-styles', { ...offline, 'services/app/lib/offline/file-html.ts': '', 'services/app/lib/offline/solid-entry.tsx': '' })).toMatch(/browser leaf document-root/);
    });

    it('lib/compiled-page: the index and its three heavy entries from anywhere, the leaves only from the offline file', () => {
      const leaves = ['agent-discovery', 'carriers', 'story-element'];
      const page = {
        ...Object.fromEntries(['index', 'compiler', 'bundle.server', 'backfill.server', 'assembler', 'contract', ...leaves].map(file => [`services/app/lib/compiled-page/${file}.ts`, ''])),
        'services/app/lib/offline/file-html.ts': leaves.map(leaf => `import '@/lib/compiled-page/${leaf}';`).join('\n'),
        'services/app/server/app.ts': "import { agentDiscovery, assembleReaderPage } from '@/lib/compiled-page';\n",
        'services/app/lib/publish/prepared/serve.server.ts': "export const ssr = () => import('@/lib/compiled-page/bundle.server');\n",
        'services/app/lib/publish/prepared/draft-compile-worker.ts': "import { compilePage } from '@/lib/compiled-page/compiler';\n",
        'scripts/compiled-backfill.ts': "import type { BackfillFilter } from '@/lib/compiled-page/backfill.server';\n",
      };
      expect(check('lib/compiled-page', page)).toBe('');
      const refused = check('lib/compiled-page', {
        ...page,
        'services/app/server/routes.ts': "import { agentDiscovery } from '@/lib/compiled-page/agent-discovery';\n",
        'services/app/lib/offline/assemble.server.ts': "import { withStoredCarriers } from '@/lib/compiled-page/carriers';\n",
        'services/app/lib/publish/prepared/c.ts': "import type { CompiledPage } from '@/lib/compiled-page/contract';\nimport '../../compiled-page/assembler';\n",
      });
      for (const line of ['services/app/server/routes.ts imports @/lib/compiled-page/agent-discovery', 'services/app/lib/offline/assemble.server.ts imports @/lib/compiled-page/carriers',
        'services/app/lib/publish/prepared/c.ts imports @/lib/compiled-page/contract', 'services/app/lib/publish/prepared/c.ts imports ../../compiled-page/assembler']) expect(refused).toContain(line);
      expect(check('lib/compiled-page', { ...page, 'services/app/lib/offline/file-html.ts': "import '@/lib/compiled-page/carriers';\n" })).toMatch(/browser leaf agent-discovery\n  browser leaf story-element/);
    });
  });

  describe('lib/accounts row as shipped (DEEP_MODULES)', () => {
    const check = files => checkModuleGraph(scanModuleGraph(tree(files)), allowList([])).violations.join('\n');
    const accounts = {
      'services/app/lib/accounts/index.ts': '', 'services/app/lib/accounts/tokens.ts': '', 'services/app/lib/accounts/viewer.ts': '', 'services/app/lib/accounts/actors.ts': '',
      'services/app/lib/serving/a.ts': "import { sessionActor, type TokenActor } from '@/lib/accounts';\n",
      'services/app/lib/workspace/b.ts': "import { LIVE_TOKEN_SQL } from '../accounts/tokens';\n",
      'services/app/solid/pages/Profile.tsx': "import type { ProfileSocial } from '@/lib/accounts';\n",
    };

    it('passes the index from anywhere and tokens, the path a downstream deployment imports', () => {
      expect(check(accounts)).toBe('');
    });

    it('refuses any other path, from server or browser code', () => {
      const refused = check({
        ...accounts,
        'services/app/lib/runner.ts': "import { sessionActor } from './accounts/viewer';\n",
        'services/app/lib/remote/c.ts': "import type { RoleActor } from '@/lib/accounts/actors';\n",
        'services/app/solid/components/PageBar.tsx': "import { CHROME_IDENTITY } from '@/lib/accounts/chrome-identity';\n",
      });
      for (const line of ['services/app/lib/runner.ts imports ./accounts/viewer', 'services/app/lib/remote/c.ts imports @/lib/accounts/actors',
        'services/app/solid/components/PageBar.tsx imports @/lib/accounts/chrome-identity']) expect(refused).toContain(line);
    });
  });

  describe('CLI toolkit entry (rule 5)', () => {
    const check = files => checkModuleGraph(scanModuleGraph(tree(files)), allowList([])).violations.join('\n');

    it('passes CLI source through the toolkit entries, and leaves CLI scripts and tests alone', () => {
      expect(check({
        'services/cli/src/a.ts': "import { parseJsx } from '../../app/lib/cli-toolkit';\nimport { compilePage } from '../../app/lib/cli-toolkit/host.server';\nimport type { X } from '@/lib/cli-toolkit/index.ts';\n",
        'services/cli/src/preview/b.tsx': "import { PageBar } from '../../../app/lib/cli-toolkit/browser';\nimport { y } from '@artifactbin/contracts';\nimport './c';\n",
        'services/cli/src/preview/connect.tsx': "import { FileConnectReceiver } from '../../../app/lib/cli-toolkit/browser-connect';\n",
        'services/cli/scripts/build.mjs': "import '../../app/lib/serving/app-font-face-css.mjs';\n",
        'services/cli/test/fixtures/worker.ts': "import { getDb } from '../../../app/lib/platform/db';\n",
      })).toBe('');
    });

    it('refuses a deep import of app code from CLI source, naming the rule and every import', () => {
      const violations = check({
        'services/cli/src/a.ts': "import { parseJsx } from '../../app/lib/jsx';\n",
        'services/cli/src/preview/e.ts': "export const morph = () => import('../../../app/lib/story-runtime/edit/session');\n",
        'services/cli/src/t.ts': "export type T = import('@/solid/components/PageBar').T;\n",
        'services/cli/src/k.ts': "import '../../app/lib/cli-toolkit/other';\n",
      });
      expect(violations).toContain('The CLI imports app code only through lib/cli-toolkit (CLI_TOOLKIT_ENTRIES in scripts/ci/module-graph.mjs)');
      expect(violations).toContain('services/cli/src/a.ts imports ../../app/lib/jsx');
      expect(violations).toContain('services/cli/src/preview/e.ts imports ../../../app/lib/story-runtime/edit/session');
      expect(violations).toContain('services/cli/src/t.ts imports @/solid/components/PageBar');
      expect(violations).toContain('services/cli/src/k.ts imports ../../app/lib/cli-toolkit/other');
    });
  });

  it('records today\'s library cycles as the allow-list', () => {
    expect(recordAllowedCycles(scanModuleGraph(tree(libCycle))).cycles).toEqual([ab]);
  });

  it('passes on this repository within the time budget', () => {
    const started = Date.now();
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(result.stderr + result.stdout).toMatch(/module graph/);
    expect(result.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
