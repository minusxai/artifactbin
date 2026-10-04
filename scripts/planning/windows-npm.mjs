/** Planning probe: candidate npm packaging, not a published release or a bootstrap installer. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

assert.equal(process.platform, 'win32', 'This acceptance requires native Windows');
const exec = promisify(execFile);
const repo = resolve('.');
const out = join(repo, '.agent/windows-npm-evidence');
const root = await mkdtemp(join(process.argv[2], 'npm é '));
const workspace = join(root, 'workspace with spaces');
await mkdir(workspace);
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const npm = join(dirname(process.execPath), 'npm.cmd');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const env = { ...process.env, ARTIFACTBIN_HOME: join(root, 'state'), CLI__AUTO_UPDATE: 'off', CLI__SERVICE_BASE_URL: 'http://127.0.0.1:1', npm_config_cache: join(root, 'cold cache'), PLAYWRIGHT_BROWSERS_PATH: join(root, 'cold browsers') };
await mkdir(join(root, 'temp'));
env.TEMP = join(root, 'temp');
env.TMP = env.TEMP;
// The workflow launches through PowerShell 7. Its inherited module path is invalid for 5.1.
env.PSModulePath = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
delete env.NODE_PATH;
delete env.NODE_OPTIONS;
delete env.ARTIFACTBIN_TOKEN;
delete env.ARTIFACTBIN_REFRESH_TOKEN;
const evidence = [];
let stage = 'privilege';
const record = message => { evidence.push(message); console.log('ok ' + message); };
async function ps(script, cwd = workspace) {
  console.log(new Date().toISOString() + ' running ' + stage);
  return exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; " + script, 'utf16le').toString('base64')], { cwd, env, timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
}
const command = (file, args) => `& ${quote(file)} ${args.map(quote).join(' ')}; if ($LASTEXITCODE -ne 0) { throw "Command failed: $LASTEXITCODE" }`;
try {
  assert.equal((await ps('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)')).stdout.trim(), 'False');
  // Start-Process -Credential changes the identity but inherits the parent profile environment.
  // Read this identity's real loaded profile, rather than silently installing into runneradmin.
  const userProfile = (await ps("$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $key=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\'+$sid); [Environment]::ExpandEnvironmentVariables($key.GetValue('ProfileImagePath'))")).stdout.trim();
  assert.match(userProfile, /mxmx_test_npm/i);
  env.USERPROFILE = userProfile;
  env.HOME = userProfile;
  env.LOCALAPPDATA = join(userProfile, 'AppData/Local');
  env.APPDATA = join(userProfile, 'AppData/Roaming');
  env.CODEX_HOME = join(userProfile, '.codex');
  await ps('Set-ExecutionPolicy -Scope CurrentUser Restricted -Force');
  record('Separate standard user; Windows PowerShell 5.1 Restricted policy');
  stage = 'candidate packaging';
  const candidate = join(root, 'candidate');
  await mkdir(candidate);
  await cp(join(repo, 'services/cli/dist'), join(candidate, 'dist'), { recursive: true });
  await mkdir(join(candidate, 'scripts'));
  await cp(join(repo, 'services/cli/scripts/prepare-pty.mjs'), join(candidate, 'scripts/prepare-pty.mjs'));
  const manifest = JSON.parse(await readFile(join(repo, 'services/cli/package.json'), 'utf8'));
  // This unpublished workspace dependency is already bundled. The current manifest cannot install.
  delete manifest.dependencies['@artifactbin/sql'];
  delete manifest.devDependencies;
  await writeFile(join(candidate, 'package.json'), JSON.stringify(manifest, null, 2));
  await ps(command(npm, ['install', '--package-lock-only', '--ignore-scripts']), candidate);
  await ps(command(npm, ['shrinkwrap']), candidate);
  manifest.files.push('npm-shrinkwrap.json');
  await writeFile(join(candidate, 'package.json'), JSON.stringify(manifest, null, 2));
  const packed = JSON.parse((await ps(command(npm, ['pack', '--json']), candidate)).stdout);
  assert.ok(packed[0].files.some(file => file.path === 'npm-shrinkwrap.json'));
  const tarball = join(candidate, packed[0].filename);
  record('Candidate removes bundled workspace dependency and includes npm-shrinkwrap.json');
  stage = 'cold installation';
  // The prefix is deliberately owned by this user's profile, never Program Files.
  const prefix = (await ps("Join-Path $env:LOCALAPPDATA 'artifactbin'")).stdout.trim();
  await ps(command(npm, ['install', '--global', '--prefix', prefix, tarball]));
  const cli = join(prefix, 'afbin.cmd');
  assert.equal((await ps('Get-ExecutionPolicy -Scope CurrentUser')).stdout.trim(), 'Restricted');
  assert.deepEqual(await readdir(env.PLAYWRIGHT_BROWSERS_PATH).catch(() => []), []);
  record('Cold npm.cmd install in user-owned prefix; no elevation, policy change, or Chromium download');
  stage = 'PATH';
  // setup-node edits only the runner process PATH. Model an already installed Node prerequisite
  // explicitly; this is not evidence that the Node desktop installer configured PATH correctly.
  await ps(`$prefix=${quote(prefix)}; $p=[Environment]::GetEnvironmentVariable('Path','User'); [Environment]::SetEnvironmentVariable('Path',($p+';'+${quote(dirname(process.execPath))}+';'+$prefix),'User')`);
  const fresh = `$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); `;
  assert.equal((await ps(fresh + '(Get-Command afbin.cmd).Source')).stdout.trim().toLowerCase(), cli.toLowerCase());
  const version = JSON.parse((await ps(fresh + command('afbin.cmd', ['--version', '--json']))).stdout);
  assert.equal(version.version, manifest.version);
  // Bare afbin resolves afbin.ps1 first: Restricted policy must be explicitly accounted for in docs.
  await assert.rejects(ps(fresh + command('afbin', ['--version', '--json'])), error => /running scripts is disabled|cannot be loaded|UnauthorizedAccess/i.test(error.stderr));
  record('Fresh shell resolves afbin.cmd; bare afbin is rejected by Restricted policy (document .cmd explicitly)');
  stage = 'SQL outside checkout';
  await writeFile(join(workspace, 'rows.csv'), 'amount\n42\n');
  const queried = JSON.parse((await ps(command(cli, ['query', 'rows.csv', '--json']))).stdout);
  assert.equal(queried.results[0].rows[0].amount, 42);
  record('Installed CLI queries local CSV with unavailable cloud endpoint, outside repository');
  stage = 'native dependencies';
  const packageRoot = join(prefix, 'node_modules/@artifactbin/cli');
  const probe = join(root, 'native.mjs');
  await writeFile(probe, `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; const r=createRequire(${JSON.stringify(join(packageRoot, 'package.json'))}); (async()=>{const png=await r('sharp')({create:{width:2,height:2,channels:4,background:'#ffffff'}}).png().toBuffer(); assert.equal(png.subarray(1,4).toString(),'PNG'); const pty=r('node-pty').spawn(process.env.ComSpec,['/d','/c','echo npm_native_ok'],{cols:80,rows:24}); let text=''; const timer=setTimeout(()=>{pty.kill();process.exit(2)},15000); pty.onData(data=>text+=data); pty.onExit(()=>{clearTimeout(timer);assert.match(text,/npm_native_ok/);console.log('sharp and ConPTY executed')})})().catch(e=>{console.error(e);process.exit(1)});`);
  await ps(command(process.execPath, [probe]));
  record('Installed sharp native DLL and node-pty ConPTY actually execute');
  stage = 'npx cache';
  const execArgs = ['exec', '--yes', '--package', tarball, '--', 'afbin.cmd', 'query', 'rows.csv', '--json'];
  assert.equal(JSON.parse((await ps(command(npm, execArgs))).stdout).results[0].rows[0].amount, 42);
  const offlineArgs = ['exec', '--offline', '--yes', '--package', tarball, '--', 'afbin.cmd', 'query', 'rows.csv', '--json'];
  assert.equal(JSON.parse((await ps(command(npm, offlineArgs))).stdout).results[0].rows[0].amount, 42);
  record('npm exec (npx engine) executes candidate; warmed cache executes with npm --offline');
  stage = 'explicit update';
  const updatedVersion = '0.3.20';
  manifest.version = updatedVersion;
  await writeFile(join(candidate, 'package.json'), JSON.stringify(manifest, null, 2));
  const entry = join(candidate, 'dist/afbin.mjs');
  const original = await readFile(entry, 'utf8');
  assert.ok(original.includes('version:"0.3.19"'), 'Probe must find embedded CLI version');
  await writeFile(entry, original.replace('version:"0.3.19"', `version:"${updatedVersion}"`));
  await ps(command(npm, ['install', '--package-lock-only', '--ignore-scripts']), candidate);
  const updated = JSON.parse((await ps(command(npm, ['pack', '--json']), candidate)).stdout);
  await ps(command(npm, ['install', '--global', '--prefix', prefix, join(candidate, updated[0].filename)]));
  assert.equal(JSON.parse((await ps(command(cli, ['--version', '--json']))).stdout).version, updatedVersion);
  assert.equal(JSON.parse((await ps(command(cli, ['query', 'rows.csv', '--json']))).stdout).results[0].rows[0].amount, 42);
  record('Explicit npm update with CLI closed installs next candidate and retains working local SQL');
  await writeFile(join(out, 'results.json'), JSON.stringify({ status: 'passed', platform: process.platform, node: process.version, evidence, limitations: ['Windows Server 2022, not fresh Windows 11 desktop', 'Node preinstalled by setup-node; Node GUI installation and missing/old Node bootstrap remain untested', 'Candidate tarballs, not public npm release', 'No full offline preview/export or update-notice integration tested here'] }, null, 2));
} catch (error) {
  await writeFile(join(out, 'results.json'), JSON.stringify({ status: 'failed', stage, message: error.message, stdout: error.stdout, stderr: error.stderr, evidence }, null, 2));
  throw error;
}
