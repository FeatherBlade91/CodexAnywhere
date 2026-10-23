import test from 'node:test';
import assert from 'node:assert/strict';
import {ResponseAccumulator} from '../response-accumulator.mjs';
import {toMessage} from '../protocol.mjs';
const usage={input_tokens:12,output_tokens:8,input_tokens_details:{cached_tokens:3}};
const message={id:'m1',type:'message',role:'assistant',content:[{type:'output_text',text:'STACK_LUNA_OK'}]};
const call={id:'fc1',type:'function_call',call_id:'call1',name:'Read',arguments:'{"path":"fixture.txt"}'};
function collect(events,final={output:[],usage}){const c=new ResponseAccumulator();for(const e of events)c.observe(e);return c.complete(final)}
test('real SIWC empty completed.output recovers output_item.done and preserves usage',()=>{
  const response=collect([{type:'response.output_item.added',output_index:0,item:{...message,content:[]}},{type:'response.output_item.done',output_index:0,item:message}]);
  const converted=toMessage(response);
  assert.deepEqual(converted.content,[{type:'text',text:'STACK_LUNA_OK'}]);
  assert.deepEqual(converted.usage,{input_tokens:9,output_tokens:8,cache_read_input_tokens:3,cache_creation_input_tokens:0});
});
test('text deltas reconstruct missing items without done events',()=>{
  const result=collect(['STACK_','LUNA_OK'].map(delta=>({type:'response.output_text.delta',output_index:0,content_index:0,delta})),{usage});
  assert.equal(toMessage(result).content[0].text,'STACK_LUNA_OK');
});
test('authoritative text and part done replace deltas rather than duplicate them',()=>{
  const result=collect([{type:'response.output_text.delta',output_index:0,content_index:0,delta:'STACK_'},{type:'response.output_text.done',output_index:0,content_index:0,text:'STACK_LUNA_OK'},{type:'response.content_part.done',output_index:0,content_index:0,part:message.content[0]}]);
  assert.equal(toMessage(result).content[0].text,'STACK_LUNA_OK');
});
test('function deltas and done recover tool input and tool_use stop reason',()=>{
  const result=collect([{type:'response.output_item.added',output_index:0,item:{...call,arguments:''}},{type:'response.function_call_arguments.delta',output_index:0,delta:'{"path":'},{type:'response.function_call_arguments.delta',output_index:0,delta:'"fixture.txt"}'},{type:'response.function_call_arguments.done',output_index:0,arguments:call.arguments}]);
  const converted=toMessage(result);assert.equal(converted.stop_reason,'tool_use');
  assert.deepEqual(converted.content,[{type:'tool_use',id:'call1',name:'Read',input:{path:'fixture.txt'}}]);
});
test('reasoning encrypted content retained in output before tools',()=>{
  const reasoning={id:'r1',type:'reasoning',encrypted_content:'opaque-fixture'};
  const result=collect([{type:'response.output_item.done',output_index:1,item:call},{type:'response.output_item.done',output_index:0,item:reasoning}]);
  assert.deepEqual(result.output,[reasoning,call]);
});
test('refusal deltas and done preserve refusal text',()=>{
  const result=collect([{type:'response.refusal.delta',output_index:0,content_index:0,delta:'Cannot '},{type:'response.refusal.delta',output_index:0,content_index:0,delta:'comply.'},{type:'response.refusal.done',output_index:0,content_index:0,refusal:'Cannot comply.'}]);
  assert.deepEqual(toMessage(result).content,[{type:'text',text:'Cannot comply.'}]);
});
test('populated completed output authoritative without duplicates',()=>{
  const final={output:[message,call],usage};
  const result=collect([{type:'response.output_text.delta',output_index:0,content_index:0,delta:'STACK_LUNA_OK'},{type:'response.output_item.done',output_index:1,item:call}],final);
  assert.equal(result,final);assert.equal(toMessage(result).content.length,2);
});
test('multiple content parts and empty response are preserved safely',()=>{
  const result=collect([{type:'response.output_text.delta',output_index:0,content_index:1,delta:'second'},{type:'response.output_text.delta',output_index:0,content_index:0,delta:'first'}]);
  assert.deepEqual(toMessage(result).content.map(x=>x.text),['first','second']);
  assert.deepEqual(collect([]).output,[]);
});
