import { resolveModelId } from './model-mapping.mjs';
import { client, config } from './runtime.mjs';
import { createModelCache } from './model-cache.mjs';
import { EFFORT_LEVELS } from './protocol.mjs';
const cache = createModelCache(() => client.withAccessToken(async (token, signal) => {
    signal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal });
    if (!res.ok) throw new Error(`Model discovery HTTP ${res.status}`);
    const data = await res.json();
    const result = (data.models || []).filter(m => m.visibility === 'list').map(m => ({
      slug: m.slug, displayName: m.display_name || m.slug,
      efforts: (m.supported_reasoning_levels || EFFORT_LEVELS.map(effort=>({effort}))).map(e=>e.effort).filter(e=>EFFORT_LEVELS.includes(e)),
      defaultEffort: m.default_reasoning_level || 'medium',
      contextWindow: m.context_window || 200000,
      maxContextWindow: m.max_context_window || m.context_window || 200000,
      supportsExperimentalContext: m.supports_experimental_context === true,
    }));
    if (!result.length) throw new Error('No models available for this ChatGPT account.');
    return result;
  }));
export function clearModels() { cache.clear(); }
export function models(refresh = false) { return cache.get(refresh); }
export async function selectModel(requested) {
  const slug = resolveModelId(requested, config);
  let model = (await models()).find(m => m.slug === slug);
  if (!model) model = (await models(true)).find(m => m.slug === slug);
  if (!model) { const e = new Error(`Model ${slug} is not available for this account. Refresh models or sign in again.`); e.status = 400; e.code = 'model_unavailable'; throw e; }
  return model;
}
