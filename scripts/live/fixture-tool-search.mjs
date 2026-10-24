// Side-effect-free MCP fixture. Its random marker proves tools/call executed.
import {createInterface} from 'node:readline';
const marker = process.env.BRIDGE_TOOL_SEARCH_MARKER;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({input:process.stdin}).on('line', line => {
  let request; try { request=JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  let result;
  if(request.method==='initialize') result={protocolVersion:request.params?.protocolVersion || '2024-11-05',capabilities:{tools:{}},serverInfo:{name:'bridge-fixture',version:'1.0.0'}};
  else if(request.method==='tools/list') result={tools:[{name:'read_verification_marker',description:'Return the secret randomized verification marker for this test. Invoke this tool to discover the value.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
  else if(request.method==='tools/call' && request.params?.name==='read_verification_marker') result={content:[{type:'text',text:marker || 'MISSING_MARKER'}]};
  else if(request.method==='ping') result={};
  else return send({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Method not found'}});
  send({jsonrpc:'2.0',id:request.id,result});
});
