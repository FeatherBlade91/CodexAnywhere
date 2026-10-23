// Development-only probe: report event structure, never credentials or text.
import {client} from './runtime.mjs';
import {readSSE} from './protocol.mjs';
await client.withAccessToken(async token=>{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({model:'gpt-6-luna',input:[{role:'user',content:'Reply exactly STACK_LUNA_OK'}],stream:true,store:false,reasoning:{effort:'low'}})});
  if(!response.ok)throw Error(`HTTP ${response.status}`);
  for await(const e of readSSE(response.body))console.log(JSON.stringify({type:e.type,output_index:e.output_index,content_index:e.content_index,item:e.item?{type:e.item.type,keys:Object.keys(e.item),content:e.item.content?.map(p=>({type:p.type,textLength:p.text?.length}))}:undefined,deltaLength:e.delta?.length,response:e.response?{keys:Object.keys(e.response),output:e.response.output?.map(i=>({type:i.type,keys:Object.keys(i),content:i.content?.map(p=>({type:p.type,textLength:p.text?.length}))})),output_text_length:e.response.output_text?.length,usage:e.response.usage}:undefined}));
});
