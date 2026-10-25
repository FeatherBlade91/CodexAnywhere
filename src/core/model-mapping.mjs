export const DEFAULT_MODEL_MAPPING = Object.freeze({
  haiku: 'gpt-6-luna', sonnet: 'gpt-6-sol', opus: 'gpt-6.1-sol', fable: 'gpt-6-astra',
});
export function modelMapping(settings = {}) {
  return { ...DEFAULT_MODEL_MAPPING, ...settings.modelMapping };
}
export function validateModelMapping(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide all four model mappings.');
  const result = {};
  for (const role of Object.keys(DEFAULT_MODEL_MAPPING)) {
    const id = value[role];
    if (typeof id !== 'string' || !/^gpt-[a-z0-9][a-z0-9.-]*$/.test(id.trim())) throw new Error(`Invalid ${role} model ID. Use an exact gpt- model ID.`);
    result[role] = id.trim();
  }
  return result;
}
export function resolveModelId(requested, settings = {}) {
  const mapping = modelMapping(settings);
  const id = typeof requested === 'string' ? requested.trim().replace(/\[1m\]$/i, '').trim() : '';
  if (!id) return mapping.sonnet;
  const role = (id.match(/^(haiku|sonnet|opus|fable)$/i)?.[1]
    || (/^claude-/i.test(id) ? id.match(/(?:^|-)(haiku|sonnet|opus|fable)(?:$|-)/i)?.[1] : undefined))?.toLowerCase();
  if (role) return mapping[role];
  return id;
}
