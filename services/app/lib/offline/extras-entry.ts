/**
 * The offline file's EXTRAS — the source editor (code view) and prettier
 * ("View formatted"), which a downloaded file does not carry.
 *
 * Built by scripts/build-offline.mjs as its own classic IIFE, served
 * content-addressed at `/offline/extras-<hash>.js`, and loaded by an open file
 * with an SRI-pinned `<script>` the first time someone opens code view
 * (lib/offline/extras). No React here: components/SourceEditor stays in the
 * file's own bundle and mounts the engine below; the file's bundle reads every
 * module below back off `globalThis.__afbinExtras` (the build stubs them to it).
 */
import * as sourceEditor from '@/lib/source-editor/codemirror';
import * as prettier from 'prettier/standalone';
import babel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';
import type { OfflineExtras } from './extras';

const extras: OfflineExtras = { sourceEditor, prettier, babel, estree };
globalThis.__afbinExtras = extras;
