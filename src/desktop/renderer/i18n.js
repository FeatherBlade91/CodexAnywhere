import { translations } from './translations.js';

export const languageChoices = ['system', 'zh-CN', 'zh-TW', 'en'];
export function resolveLanguage(preference, systemLanguages = []) {
  if (languageChoices.includes(preference) && preference !== 'system') return preference;
  const locale = String(systemLanguages[0] || 'en').replaceAll('_', '-').toLowerCase();
  if (!locale.startsWith('zh')) return 'en';
  if (locale.includes('hant')) return 'zh-TW';
  if (locale.includes('hans')) return 'zh-CN';
  return /(?:^|-)(tw|hk|mo)(?:-|$)/.test(locale) ? 'zh-TW' : 'zh-CN';
}

export function translator(language) {
  return (source, values = {}) => (translations[source]?.[language] || source)
    .replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

// Translate only the initial app-owned markup, never user data or model descriptions.
export function localizeDocument(document, t, language) {
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.body, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) continue;
    const source = node.textContent.trim();
    if (translations[source]) node.textContent = node.textContent.replace(source, t(source));
  }
  for (const element of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const attribute of ['aria-label', 'placeholder', 'title']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
    }
  }
}
