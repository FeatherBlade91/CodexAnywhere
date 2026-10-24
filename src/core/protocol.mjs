import { randomUUID } from 'node:crypto';
export const MODEL = 'gpt-6.1-sol';
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export function resolveEffort(body, supported = EFFORT_LEVELS) {
  const effort = body.output_config?.effort;
  if (effort === undefined && supported.length) return supported.includes('high') ? 'high' : supported[0];
  if (EFFORT_LEVELS.includes(effort) && supported.includes(effort)) return effort;
  const error = new Error(`Unsupported effort: ${String(effort)}. This model supports: ${supported.join(', ')}.`);
  error.status = 400;
  error.code = 'unsupported_effort';
  throw error;
}
const list = x => typeof x === 'string' ? [{ type: 'text', text: x }] : x || [];
const text = x => list(x).filter(b => b.type === 'text').map(b => b.text).join('\n');
function content(block, role) {
  if (block.type === 'text') return { type: role === 'assistant' ? 'output_text' : 'input_text', text: block.text };
  // Claude ToolSearch returns references to definitions in the request's tools
  // array. We already expose those definitions as functions (including deferred
  // tools), so preserve the reference as data instead of sending an Anthropic-
  // specific content type to Responses or dropping the search result.
  if (block.type === 'tool_reference' && typeof block.tool_name === 'string')
    return { type: role === 'assistant' ? 'output_text' : 'input_text', text: JSON.stringify({tool_reference:block.tool_name}) };
  if (block.type === 'image') {
    const s = block.source;
    return { type: 'input_image', image_url: s.type === 'base64' ? `data:${s.media_type};base64,${s.data}` : s.url };
  }
  if (block.type === 'document' && block.source?.type === 'text') return { type: 'input_text', text: block.source.data };
  if (block.type === 'document' && block.source?.type === 'base64') return { type: 'input_file', filename: block.title || 'document.pdf', file_data: `data:${block.source.media_type};base64,${block.source.data}` };
  const error = new Error(`Unsupported input block: ${block.type}`);
  error.status = 400; error.code = 'unsupported_input_block'; throw error;
}
export function toResponses(body, reasoningCache = new Map(), selectedModel = { slug: MODEL, efforts: EFFORT_LEVELS }) {
  const input = [];
  for (const message of body.messages || []) {
    let pending = [];
    const flush = () => { if (pending.length) { input.push({ role: message.role, content: pending }); pending = []; } };
    for (const block of list(message.content)) {
      if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
      if (block.type === 'tool_use') {
        flush();
        const reasoning = reasoningCache.get(block.id);
        if (reasoning) input.push(...reasoning);
        input.push({ type: 'function_call', call_id: block.id, name: block.name, namespace: 'claude', arguments: JSON.stringify(block.input) });
      } else if (block.type === 'tool_result') {
        flush();
        const blocks = list(block.content);
        const output = blocks.every(b => b.type === 'text') ? text(block.content) : blocks.map(b => content(b, 'user'));
        input.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.is_error ? 'Tool error: ' + (typeof output === 'string' ? output : JSON.stringify(output)) : output });
      } else pending.push(content(block, message.role));
    }
    flush();
  }
  let functions = (body.tools || []).filter(t => t.input_schema).map(t => ({ type: 'function', name: t.name, description: t.description || '', parameters: t.input_schema, strict: false }));
  if (body.tool_choice?.type === 'tool') {
    functions = functions.filter(tool => tool.name === body.tool_choice.name);
    if (functions.length !== 1) {
      const error = new Error('The selected tool must have exactly one definition with an input schema.');
      error.status = 400; error.code = 'invalid_tool_choice'; throw error;
    }
  }
  const request = { model: selectedModel.slug, instructions: text(body.system), input, stream: true, store: false, include: ['reasoning.encrypted_content'] };
  if (functions.length) request.tools = [{ type: 'namespace', name: 'claude', description: 'Tools executed locally by Claude Code.', tools: functions }];
  if (body.tool_choice?.type === 'none') request.tool_choice = 'none';
  else if (body.tool_choice?.type === 'any') request.tool_choice = 'required';
  // Responses function tool_choice cannot select a function in a namespace.
  // Restrict available definitions to the selected function and require a call;
  // prior calls/results in input remain intact for conversation continuity.
  else if (body.tool_choice?.type === 'tool') request.tool_choice = 'required';
  request.reasoning = { effort: resolveEffort(body, selectedModel.efforts) };
  return request;
}
export async function* readSSE(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
    let i;
    while ((i = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, i); buffer = buffer.slice(i + 2);
      const data = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}
export function toMessage(response, model = response.model || MODEL) {
  const blocks = [];
  for (const item of response.output || []) {
    if (item.type === 'message') for (const c of item.content || []) {
      if (c.type === 'output_text') blocks.push({ type: 'text', text: c.text });
      else if (c.type === 'refusal') blocks.push({ type: 'text', text: c.refusal });
    }
    if (item.type === 'function_call') blocks.push({ type: 'tool_use', id: item.call_id, name: item.name, input: JSON.parse(item.arguments || '{}') });
  }
  const cached = response.usage?.input_tokens_details?.cached_tokens || 0;
  return { id: 'msg_' + randomUUID().replaceAll('-', ''), type: 'message', role: 'assistant', model, content: blocks, stop_reason: blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: Math.max(0, (response.usage?.input_tokens || 0) - cached), output_tokens: response.usage?.output_tokens || 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } };
}
