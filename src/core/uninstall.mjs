import { readFile, access, lstat, realpath } from 'node:fs/promises';
import { join, resolve, parse } from 'node:path';

// Called before NSIS removes any program/data files. A failed restore must leave
// the installation and its recovery backups available for another attempt.
export async function prepareUninstall({ stateDir, restore, disableStartup }) {
  const directory = resolve(stateDir);
  if (directory === parse(directory).root) throw new Error('Invalid application data directory.');
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw new Error('The application data directory is redirected. No application data was removed.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config;
  try { config = JSON.parse(await readFile(join(stateDir, 'bridge.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Saved configuration could not be read. No application data was removed.'); }
  if (config?.integration) {
    const backup = config.integration === 'direct' ? 'direct-restore.json' : config.integration === 'cc-switch' ? 'cc-restore.json' : null;
    if (!backup) throw new Error('Unknown integration. Restore the client configuration before uninstalling.');
    try { await access(join(stateDir, backup)); }
    catch { throw new Error('The client restore backup is missing. Restore the client configuration before uninstalling.'); }
    await restore();
  }
  await disableStartup();
}
