import { client, stateDir, config } from './runtime.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EFFORT_LEVELS } from './protocol.mjs';
let cached;
let pending;
export async function models(refresh = false) {
  if (!refresh && cached && Date.now() - cached.time < 60_000) return cached.models;
  if (pending) return pending;
  pending = client.withAccessToken(async (token, signal) => {
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
    cached = { time: Date.now(), models: result };
    await writeFile(join(stateDir, 'models.json'), JSON.stringify(cached, null, 2));
    return result;
  }).finally(() => { pending = undefined; });
  return pending;
}
export async function selectModel(requested) {
  const normalized=typeof requested==='string'?requested.trim():requested;
  const slug = !normalized || /^(claude-|sonnet|opus|haiku)/.test(normalized) ? config.model : normalized.replace(/\[1m\]$/i, '').trim();
  const model = (await models()).find(m => m.slug === slug);
  if (!model) { const e = new Error(`Model ${slug} is not available for this account. Refresh models or sign in again.`); e.status = 400; e.code = 'model_unavailable'; throw e; }
  return model;
}
