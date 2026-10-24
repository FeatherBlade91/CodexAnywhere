const invalid = message => Object.assign(new Error(message), { status: 400, code: 'invalid_request_error' });
export function chatPayload(body) {
  if (!Array.isArray(body.messages) || !body.messages.length) throw invalid('messages must be a non-empty array');
  if (body.n !== undefined && body.n !== 1) throw invalid('Only n=1 is supported');
  for (const key of ['stop', 'logprobs', 'top_logprobs', 'logit_bias', 'audio', 'modalities', 'seed', 'frequency_penalty', 'presence_penalty']) {
    if (body[key] !== undefined && body[key] !== null) throw invalid(`${key} is not supported`);
  }
  const input = [];
  for (const m of body.messages) {
    if (!m || !['system', 'developer', 'user', 'assistant', 'tool'].includes(m.role)) throw invalid('Invalid message role');
    if (m.role === 'tool') {
      if (!m.tool_call_id || typeof m.content !== 'string') throw invalid('Tool results require tool_call_id and string content');
      input.push({ type: 'function_call_output', call_id: m.tool_call_id, output: m.content });
      continue;
    }
    if (m.content != null) {
      let content = m.content;
      if (Array.isArray(content)) content = content.map(p => {
        if (p.type === 'text' && typeof p.text === 'string') return { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: p.text };
        if (p.type === 'image_url' && m.role === 'user' && typeof p.image_url?.url === 'string') return { type: 'input_image', image_url: p.image_url.url, detail: p.image_url.detail || 'auto' };
        throw invalid('Unsupported message content part');
      });
      else if (typeof content !== 'string') throw invalid('Invalid message content');
      input.push({ role: m.role === 'system' ? 'developer' : m.role, content });
    }
    for (const t of m.tool_calls || []) {
      if (t.type !== 'function' || !t.id || !t.function?.name || typeof t.function.arguments !== 'string') throw invalid('Invalid function call');
      input.push({ type: 'function_call', call_id: t.id, name: t.function.name, arguments: t.function.arguments });
    }
  }
  const payload = { model: body.model, input };
  for (const key of ['temperature', 'top_p', 'parallel_tool_calls']) if (body[key] !== undefined) payload[key] = body[key];
  if (body.max_completion_tokens !== undefined || body.max_tokens !== undefined) payload.max_output_tokens = body.max_completion_tokens ?? body.max_tokens;
  if (body.reasoning_effort) payload.reasoning = { effort: body.reasoning_effort };
  if (body.tools) payload.tools = body.tools.map(t => {
    if (t.type !== 'function' || !t.function?.name) throw invalid('Only function tools are supported');
    return { type: 'function', ...t.function };
  });
  if (body.tool_choice !== undefined) payload.tool_choice = typeof body.tool_choice === 'string' ? body.tool_choice : { type: 'function', name: body.tool_choice.function?.name };
  if (body.response_format) {
    const f = body.response_format;
    if (!['text', 'json_object', 'json_schema'].includes(f.type)) throw invalid('Invalid response_format');
    payload.text = { format: f.type === 'json_schema' ? { type: f.type, ...f.json_schema } : f };
  }
  return payload;
}
export function usage(u = {}) {
  return { prompt_tokens: u.input_tokens || 0, completion_tokens: u.output_tokens || 0, total_tokens: u.total_tokens ?? ((u.input_tokens || 0) + (u.output_tokens || 0)), prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens || 0 }, completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens || 0 } };
}
export function chatResult(r, model, id) {
  const parts = (r.output || []).flatMap(i => i.type === 'message' ? i.content || [] : []);
  const calls = (r.output || []).filter(i => i.type === 'function_call').map(i => ({ id: i.call_id, type: 'function', function: { name: i.name, arguments: i.arguments } }));
  return { id, object: 'chat.completion', created: r.created_at || Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: parts.filter(p => p.type === 'output_text').map(p => p.text).join('') || null, refusal: parts.filter(p => p.type === 'refusal').map(p => p.refusal).join('') || null, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: r.status === 'incomplete' ? 'length' : calls.length ? 'tool_calls' : 'stop' }], usage: usage(r.usage) };
}
