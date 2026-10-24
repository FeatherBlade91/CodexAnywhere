import { readdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
// Windows PowerShell 5 requires a BOM to reliably read non-ASCII scripts.
for (const name of ['dpapi.ps1']) {
  const path=new URL('../src/core/'+name,import.meta.url);
  const source=(await readFile(path,'utf8')).replace(/^\uFEFF/,'');
  await writeFile(path,'\uFEFF'+source);
}
for (const name of await readdir(new URL('../vendor/siwc/', import.meta.url))) {
  if (!name.endsWith('.ts')) continue;
  let source = await readFile(new URL('../vendor/siwc/' + name, import.meta.url), 'utf8');
  // Local extension: keep OAuth verification, locking, encrypted storage and refresh
  // in the official runtime; allow our trusted server to stream tool responses.
  if (name === 'index.ts') source = source.replace('    async signIn(options = {}) {', '    withAccessToken: authenticated,\n    async signIn(options = {}) {');
  const notice = '// Generated locally from OpenAI SIWC DevKit. Modification: index.js exposes authenticated callback as withAccessToken for the trusted local bridge. See LICENSE and docs/THIRD-PARTY-NOTICES.md.\n';
  await writeFile(new URL('../vendor/siwc/' + name.replace(/\.ts$/, '.js'), import.meta.url), notice + stripTypeScriptTypes(source));
}
