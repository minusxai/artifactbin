/**
 * The offline file's EXTRAS — Monaco (code view) and prettier ("View
 * formatted"), the ~1.2 MB a downloaded file does not carry.
 *
 * Built by scripts/build-offline.mjs as its own classic IIFE, served
 * content-addressed at `/offline/extras-<hash>.js`, and loaded by an open file
 * with an SRI-pinned `<script>` the first time someone opens code view
 * (lib/offline/extras). No React here: `@monaco-editor/react` stays in the
 * file's own bundle and is pointed at this Monaco (components/SourceEditor's
 * `loader.config({ monaco })`); the file's bundle reads every module below
 * back off `globalThis.__afbinExtras` (the build stubs them to it).
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution';
import monacoCss from 'monaco-editor/min/vs/style.css?inline';
import * as prettier from 'prettier/standalone';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';
import type { OfflineExtras } from './extras';

const extras: OfflineExtras = { monaco, monacoCss, prettier, babel, estree };
globalThis.__afbinExtras = extras;
