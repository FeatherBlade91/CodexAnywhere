import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {config} from '../runtime.mjs';
import {Agent} from 'undici';
const localDispatcher=new Agent();
const report={date:new Date().toISOString(),cases:[]};
for(const mode of ['text','tool']){
 const body={model:'gpt-6-luna[1M]',max_tokens:80,stream:false,output_config:{effort:'low'},messages:[{role:'user',content:mode==='text'?'Reply exactly NONSTREAM_OK':'Call verify_marker with marker exactly NONSTREAM_TOOL_OK.'}]};
 if(mode==='tool'){body.tools=[{name:'verify_marker',description:'Accept a test marker.',input_schema:{type:'object',properties:{marker:{type:'string'}},required:['marker']}}];body.tool_choice={type:'tool',name:'verify_marker'};}
 const res=await fetch(`http://127.0.0.1:${config.port}/v1/messages`,{dispatcher:localDispatcher,method:'POST',headers:{'content-type':'application/json','x-api-key':config.localKey},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const message=await res.json();assert.equal(res.status,200);
 if(mode==='text')assert.equal(message.content.filter(c=>c.type==='text').map(c=>c.text).join(''),'NONSTREAM_OK');
 else{assert.equal(message.stop_reason,'tool_use');assert.equal(message.content.find(c=>c.type==='tool_use').input.marker,'NONSTREAM_TOOL_OK');}
 assert.ok(message.usage.output_tokens>0);report.cases.push({mode,passed:true,model:message.model,stopReason:message.stop_reason,outputTokens:message.usage.output_tokens});
}
await mkdir('test-results',{recursive:true});await writeFile('test-results/nonstream-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
await localDispatcher.close();
