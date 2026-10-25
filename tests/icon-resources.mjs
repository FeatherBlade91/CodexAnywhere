import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NtExecutable, NtExecutableResource, Resource, Data } from 'resedit';

const directory = resolve(process.env.BRIDGE_PACKAGE_DIR || 'dist/win-unpacked');
const icon = await readFile('src/desktop/assets/icon.ico');
const digest = item => createHash('sha256').update(Buffer.from(typeof item.generate === 'function' ? item.generate() : item.bin)).digest('hex');
const expected = Data.IconFile.from(icon).icons.map(item => digest(item.data));
assert((await readFile(join(directory, 'resources/app-icon.ico'))).equals(icon), 'Shortcut icon must match canonical artwork');
const executable = NtExecutable.from(await readFile(join(directory, 'Codex-Anywhere.exe')));
const resources = NtExecutableResource.from(executable);
const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
assert(groups.some(group => JSON.stringify(group.getIconItemsFromEntries(resources.entries).map(digest)) === JSON.stringify(expected)), 'Executable icons must match canonical artwork at every size');
console.log('Standalone shortcut icon and all executable icon sizes match canonical artwork.');
