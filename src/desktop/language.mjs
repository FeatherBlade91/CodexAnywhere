import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { languageChoices, resolveLanguage } from './renderer/i18n.js';

export async function loadLanguage(path, systemLanguages) {
  let preference = 'system';
  try {
    const settings = JSON.parse(await readFile(path, 'utf8'));
    if (languageChoices.includes(settings.language)) preference = settings.language;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { preference, language: resolveLanguage(preference, systemLanguages) };
}

export async function saveLanguage(path, preference) {
  if (!languageChoices.includes(preference)) throw new Error('语言设置无效。');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify({ language: preference }) + '\n', 'utf8');
  await rename(`${path}.tmp`, path);
}
