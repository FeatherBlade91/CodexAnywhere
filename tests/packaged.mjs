import assert from 'node:assert/strict';
import { extractFile, listPackage, statFile } from '@electron/asar';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, normalize, resolve } from 'node:path';

const mac = process.platform === 'darwin';
const directory = resolve(process.env.BRIDGE_PACKAGE_DIR || (mac ? `dist/mac${process.arch === 'arm64' ? '-arm64' : ''}/Codex-Anywhere.app` : 'dist/win-unpacked'));
const resources = join(directory, mac ? 'Contents/Resources' : 'resources');
const archive = join(resources, 'app.asar');
for (const entry of listPackage(archive)) {
  const name = entry.replace(/^[\\/]/, '');
  const metadata = statFile(archive, name);
  if (metadata.integrity?.hash) {
    assert.equal(createHash('sha256').update(extractFile(archive, name)).digest('hex'), metadata.integrity.hash, `Archive integrity failure: ${name}`);
  }
}
const manifest = JSON.parse(extractFile(archive, 'package.json'));
for (const name of ['vendor/siwc/storage.js', 'src/core/model-cache.mjs', 'src/core/openai-server.mjs', 'src/core/uninstall.mjs', 'src/desktop/renderer/python-example.js', 'src/desktop/assets/icon.png', 'src/desktop/assets/icon.ico']) {
  assert(extractFile(archive, normalize(name)).equals(await readFile(name)), `Packaged performance implementation differs: ${name}`);
}
assert.equal(manifest.main, 'src/desktop/main.mjs');
assert.equal(manifest.version, JSON.parse(await readFile('package.json', 'utf8')).version);
for (const name of ['src/desktop/language.mjs', 'src/desktop/localize.mjs', 'src/desktop/renderer/i18n.js', 'src/desktop/renderer/translations.js', 'src/desktop/main.mjs', 'src/desktop/worker.mjs', 'src/desktop/service.mjs', 'src/desktop/network.mjs', 'src/desktop/preload.cjs', 'src/desktop/renderer/index.html', 'src/desktop/renderer/app.js', 'src/desktop/renderer/styles.css', 'src/core/runtime.mjs', 'src/core/server.mjs', 'src/core/catalog.mjs', 'src/core/integration.mjs']) {
  assert(extractFile(archive, normalize(name)).equals(await readFile(name)), `Packaged file differs from source: ${name}`);
}
await access(join(mac ? resources : directory, 'LICENSE.electron.txt'));
await access(join(mac ? resources : directory, 'LICENSES.chromium.html'));
for (const name of ['src/platform/system.mjs', 'src/platform/credentials.mjs', 'src/desktop/credential-channel.mjs']) {
  assert(extractFile(archive, normalize(name)).equals(await readFile(name)), `Packaged platform file differs: ${name}`);
}
const script = join(directory, 'resources/app.asar.unpacked/src/core/dpapi.ps1');
async function dpapi(operation, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, operation], { windowsHide: true });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.resume();
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(new Error('Packaged credential encryption failed')));
    child.stdin.end(input.toString('base64'));
  });
}
const fixture = Buffer.from('desktop-package-test-only');
if (!mac) assert((await dpapi('decrypt', await dpapi('encrypt', fixture))).equals(fixture));
console.log('Packaged sources and licenses verified; native credential checks follow.');
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', 'tests/desktop.e2e.mjs', 'tests/language.e2e.mjs', 'tests/language-restart.e2e.mjs', 'tests/macos-credentials.e2e.mjs'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, BRIDGE_TEST_EXE: join(directory, mac ? 'Contents/MacOS/Codex-Anywhere' : 'Codex-Anywhere.exe') },
});
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
