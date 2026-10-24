/** Patch the four dependency bundles still affected in the pinned npm release. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const prefix = process.platform === 'win32' ? path.dirname(process.execPath) : path.resolve(path.dirname(process.execPath), '..');
const driver = path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'npm/bin/npm-cli.js');
const runNpm = args => execFileSync(process.execPath, [driver, ...args], { encoding: 'utf8' });
const root = runNpm(['root', '-g', '--prefix', prefix]).trim();
const npm = path.join(root, 'npm');
assert.equal(JSON.parse(readFileSync(path.join(npm, 'package.json'))).version, '11.19.1');
// Official registry tarball SHA512 values; replacements preserve their dependency declarations.
const patches = [
  ["brace-expansion", "5.0.9", "5.0.12", "sha512-YovQ3rzhaLMIrDjNDMkNS01tea93qhEhG5xy8f6+R0l+dw3Ki+5sCoIoI942iuLZTHWogWktgwVDhU09iNEimQ=="],
  ["ip-address", "10.5.0", "10.7.4", "sha512-DWBMKyeM25D70nrIiTkgQth59/G+naKOTep6huF9j+GmeK3DMD60Zvxg5d5qQnz+38AHgou6ean2LECX+lrKDg=="],
  ["postcss-selector-parser", "7.1.4", "7.1.6", "sha512-7qASPzhKF2l2KLboRZux8CCTRMdGiV08vWmyKzPz22qZ7ZjQBOeY7rNzNoCLSUiftJ7HUq0GERHmxw/t0dCdMw=="],
  ["undici", "6.28.0", "6.29.1", "sha512-EvRlUt/QqAEvXdQeRMYUfwOQsfzpDztykrG2owGEE/rBOBoYv9uF39ZzsNDh4lTFHhTr2XOZjKkYgueD12ZmGA=="],
];
const temporary = mkdtempSync(path.join(tmpdir(), 'npm-fixes-'));
try {
  for (const [name, before, version, integrity] of patches) {
    const destination = path.join(npm, 'node_modules', name);
    const installed = JSON.parse(readFileSync(path.join(destination, 'package.json'))).version;
    if (installed === version) continue;
    assert.equal(installed, before);
    const packed = JSON.parse(runNpm(['pack', `${name}@${version}`, '--ignore-scripts', '--json', '--pack-destination', temporary]));
    const archive = path.join(temporary, packed[0].filename);
    assert.equal(`sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`, integrity);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
    assert.equal(manifest.version, version);
    const original = JSON.parse(readFileSync(path.join(destination, 'package.json')));
    assert.deepEqual(manifest.dependencies ?? {}, original.dependencies ?? {});
    rmSync(destination, { recursive: true });
    mkdirSync(destination);
    execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', destination]);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
