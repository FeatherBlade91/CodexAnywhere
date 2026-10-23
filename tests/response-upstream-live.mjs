// Exercise actual SIWC output events independently of the running bridge.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {client} from '../runtime.mjs';
import {readSSE,toMessage,toResponses} from '../protocol.mjs';
import {apiError} from '../vendor/siwc/errors.js';
import {ResponseAccumulator} from '../response-accumulator.mjs';
const report={date:new Date().toISOString(),cases:[]};
for(const mode of ['text','tool']){
  const result=await client.withAccessToken(async token=>{
    const source={messages:[{role:'user',content:mode==='text'?'Reply exactly STACK_LUNA_OK':'Call verify_marker with marker exactly STACK_TOOL_OK.'}],output_config:{effort:'low'}};
    if(mode==='tool') {source.tools=[{name:'unused_tool',input_schema:{type:'object',properties:{}}},{name:'verify_marker',description:'Accept a test marker.',input_schema:{type:'object',properties:{marker:{type:'string'}},required:['marker'],additionalProperties:false}}];source.tool_choice={type:'tool',name:'verify_marker'};}
    const body=toResponses(source,new Map(),{slug:'gpt-6-luna',efforts:['low','medium','high']});
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw apiError(await response.json().catch(()=>({})),response.status);
    const accumulator=new ResponseAccumulator();let final;const eventTypes=[];let terminalOutputCount;
    for await(const e of readSSE(response.body)) {accumulator.observe(e);eventTypes.push(e.type);if(e.type==='response.completed'){terminalOutputCount=e.response.output?.length;final=accumulator.complete(e.response);}}
    assert.ok(final);const message=toMessage(final);
    if(mode==='text')assert.equal(message.content.filter(c=>c.type==='text').map(c=>c.text).join(''),'STACK_LUNA_OK');
    else {assert.equal(message.stop_reason,'tool_use');assert.equal(message.content.find(c=>c.type==='tool_use').input.marker,'STACK_TOOL_OK');}
    return {mode,passed:true,specificToolChoice:mode==='tool',terminalOutputCount,reconstructedOutputCount:final.output.length,stopReason:message.stop_reason,outputTokens:message.usage.output_tokens,eventTypes};
  });report.cases.push(result);console.log(JSON.stringify(result));
}
// Reproduce the former invalid namespace selector to prove SDK normalization
// preserves the real validation failure, rather than calling it connection_error.
try {
  await client.withAccessToken(async token=>{
    const body=toResponses({messages:[{role:'user',content:'PRIVATE_VALIDATION_TEST'}],tools:[{name:'verify_marker',input_schema:{type:'object',properties:{}}}],output_config:{effort:'low'}},new Map(),{slug:'gpt-6-luna',efforts:['low']});
    body.tool_choice={type:'function',name:'verify_marker',namespace:'claude'};
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw apiError(await response.json().catch(()=>({})),response.status);
    await response.body.cancel();throw Error('Expected invalid namespace selector to be rejected.');
  });
  assert.fail('Expected upstream rejection');
} catch(error) {
  assert.ok([400,422].includes(error.status));assert.notEqual(error.code,'connection_error');assert.equal(error.message.includes('PRIVATE_VALIDATION_TEST'),false);
  const result={mode:'typed_validation_error',passed:true,status:error.status,code:error.code};report.cases.push(result);console.log(JSON.stringify(result));
}
await mkdir('test-results',{recursive:true});await writeFile('test-results/response-upstream-live.json',JSON.stringify(report,null,2));
