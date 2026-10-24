import test from 'node:test';
import assert from 'node:assert/strict';
import { toResponses, toMessage, readSSE } from '../src/core/protocol.mjs';
import {apiError,asError,ChatGPTError} from '../vendor/siwc/errors.js';

test('specific tool choice uses one namespaced definition plus required and preserves history',()=>{
 const request=toResponses({tools:[{name:'OldTool',input_schema:{type:'object'}},{name:'verify_marker',input_schema:{type:'object',properties:{marker:{type:'string'}}}}],tool_choice:{type:'tool',name:'verify_marker'},messages:[{role:'assistant',content:[{type:'tool_use',id:'old1',name:'OldTool',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'old1',content:'old result'}]}]});
 assert.equal(request.tool_choice,'required');assert.deepEqual(request.tools[0].tools.map(t=>t.name),['verify_marker']);
 assert.equal(request.input[0].name,'OldTool');assert.equal(request.input[1].output,'old result');
 for(const tools of [[],[{name:'verify_marker'}],[{name:'verify_marker',input_schema:{}},{name:'verify_marker',input_schema:{}}]])assert.throws(()=>toResponses({tools,tool_choice:{type:'tool',name:'verify_marker'}}),{code:'invalid_tool_choice',status:400});
});

test('official typed API failures retain safe code/status across SDK normalization',()=>{
 const secret='PRIVATE_PROMPT_AND_CREDENTIAL';
 const error=apiError({error:{code:'invalid_request_error',message:secret,param:'tool_choice'}},400,'req_safe');
 assert.ok(error instanceof ChatGPTError);assert.equal(asError(error),error);assert.equal(error.status,400);assert.equal(error.code,'invalid_request_error');
 assert.equal(JSON.stringify(error.toJSON()).includes(secret),false);
 const untrusted=apiError({error:{code:secret+' unsafe',message:secret}},422);
 assert.equal(untrusted.code,'api_error');assert.equal(JSON.stringify(untrusted.toJSON()).includes(secret),false);
 assert.equal(apiError({error:{code:'rate_limit_exceeded',message:secret}},429).status,429);
});

test('ToolSearch references survive mixed results and deferred tools remain callable',()=>{
 const request=toResponses({tools:[{name:'ToolSearch',input_schema:{type:'object'}},{name:'mcp__probe__lookup',defer_loading:true,input_schema:{type:'object',properties:{key:{type:'string'}}}}],messages:[
 {role:'assistant',content:[{type:'tool_use',id:'search1',name:'ToolSearch',input:{query:'lookup'}}]},
 {role:'user',content:[{type:'tool_result',tool_use_id:'search1',content:[{type:'text',text:'Found one tool'},{type:'tool_reference',tool_name:'mcp__probe__lookup'}]}]},
 {role:'user',content:[{type:'tool_reference',tool_name:'mcp__probe__lookup'}]}
 ]});
 assert.equal(request.input[1].output[1].type,'input_text');
 assert.deepEqual(JSON.parse(request.input[1].output[1].text),{tool_reference:'mcp__probe__lookup'});
 assert.ok(request.tools[0].tools.some(t=>t.name==='mcp__probe__lookup'&&t.parameters.properties.key));
 assert.equal(request.input[2].content[0].type,'input_text');
 assert.throws(()=>toResponses({messages:[{role:'user',content:[{type:'unknown_block'}]}]}),{status:400,code:'unsupported_input_block'});
});
test('all Claude effort levels reach GPT unchanged, including max', () => {
  for (const effort of ['low','medium','high','xhigh','max']) {
    const request = toResponses({ messages: [{ role: 'user', content: 'hello' }], output_config: { effort } });
    assert.equal(request.reasoning.effort, effort);
    assert.equal(request.model, 'gpt-6.1-sol');
  }
  assert.equal(toResponses({ messages: [] }).reasoning.effort, 'high');
  assert.throws(() => toResponses({ messages: [], output_config: { effort: 'ultra' } }), { code: 'unsupported_effort', status: 400 });
});
test('multi-turn tool history, namespaces and preview restrictions', () => {
  const request = toResponses({ system: [{ type: 'text', text: 'Be helpful' }], max_tokens: 100, temperature: 0.2,
    tools: [{ name: 'Read', input_schema: { type: 'object', properties: { file: { type: 'string' } } } }],
    messages: [{ role: 'user', content: 'read file' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { file: 'a.txt' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'hello' }] }] });
  assert.equal(request.model, 'gpt-6.1-sol'); assert.equal(request.store, false); assert.equal(request.stream, true);
  assert.equal(request.tools[0].type, 'namespace'); assert.equal(request.input[1].namespace, 'claude');
  assert.equal(request.input[2].output, 'hello'); assert.equal(request.max_output_tokens, undefined); assert.equal(request.temperature, undefined);
});
test('tool response carries parsed input, stop reason and cache usage', () => {
  const message = toMessage({ output: [{ type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"file":"a.txt"}' }], usage: { input_tokens: 100, output_tokens: 12, input_tokens_details: { cached_tokens: 80 } } });
  assert.equal(message.stop_reason, 'tool_use'); assert.deepEqual(message.content[0].input, { file: 'a.txt' }); assert.equal(message.usage.input_tokens, 20);
});
test('SSE parser handles chunk boundaries and UTF-8', async () => {
  const bytes = new TextEncoder().encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你好"}\n\ndata: {"type":"response.completed"}\n\n');
  async function* chunks() { for (let i = 0; i < bytes.length; i += 3) yield bytes.slice(i, i + 3); }
  const events = []; for await (const e of readSSE(chunks())) events.push(e);
  assert.equal(events[0].delta, '你好'); assert.equal(events[1].type, 'response.completed');
});
