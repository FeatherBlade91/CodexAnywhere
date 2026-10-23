// Real Claude Code -> recording loopback relay -> live bridge -> OpenAI.
// Persist only structural metadata: no auth headers, prompts, or local paths.
import {createServer,request} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {config,stateDir} from './runtime.mjs';
const report={date:new Date().toISOString(),requests:[],passed:false};
const marker='MCP_VERIFIED_'+randomBytes(12).toString('hex');
const dir=join(stateDir,'smoke','tool-search-'+Date.now());
await mkdir(dir,{recursive:true});
const relay=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const data=Buffer.concat(chunks);
  try { const body=JSON.parse(data);const references=[];const toolCalls=[];
    const walk=x=>{if(!x||typeof x!=='object')return;if(x.type==='tool_reference')references.push(x.tool_name);if(x.type==='tool_use')toolCalls.push(x.name);for(const v of Object.values(x))if(typeof v==='object')walk(v)};walk(body.messages);
    report.requests.push({model:body.model,tools:(body.tools||[]).map(t=>({name:t.name,deferred:!!t.defer_loading,hasSchema:!!t.input_schema})),references,toolCalls});
    console.log(JSON.stringify({event:'request',model:body.model,references,toolCalls}));
  }catch{}
  const upstream=request({hostname:'127.0.0.1',port:config.port,path:req.url,method:req.method,headers:{...req.headers,host:`127.0.0.1:${config.port}`}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  upstream.on('error',()=>{res.writeHead(502);res.end('relay failure')});upstream.end(data);
});
await new Promise(r=>relay.listen(0,'127.0.0.1',r));
const model=process.argv[2]||config.model;
report.requestedModel=model;
const settingsPath=join(dir,'settings.json');
await writeFile(settingsPath,JSON.stringify({env:{ANTHROPIC_BASE_URL:`http://127.0.0.1:${relay.address().port}`,ANTHROPIC_AUTH_TOKEN:config.localKey,ANTHROPIC_MODEL:model,ENABLE_TOOL_SEARCH:'true',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}}));
const mcp={mcpServers:{bridge_fixture:{command:process.execPath,args:[resolve('fixture-tool-search.mjs')],env:{BRIDGE_TOOL_SEARCH_MARKER:marker}}}};
const env={...process.env};delete env.ORCA_CLAUDE_PROFILE_POINTER;
for(const k of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDECODE$)/.test(k))delete env[k];
const args=['--print','--setting-sources','','--settings',settingsPath,'--strict-mcp-config','--mcp-config',JSON.stringify(mcp),'--no-session-persistence','--model',model,'--effort','low','--tools','ToolSearch','--allowedTools','ToolSearch,mcp__bridge_fixture__read_verification_marker','--permission-mode','dontAsk','--system-prompt','You are testing tools. First use ToolSearch to discover read_verification_marker, then call that MCP tool and return only its exact result. Never guess the marker.','--','Discover the read_verification_marker tool with ToolSearch, invoke it, and return its marker.'];
let stdout='',stderr='';
try{
  report.exitCode=await new Promise(resolve=>{const child=spawn(join(process.env.USERPROFILE,'.local/bin/claude.exe'),args,{cwd:dir,env,windowsHide:true});child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);const timeout=setTimeout(()=>child.kill(),240000);child.on('exit',c=>{clearTimeout(timeout);resolve(c)});child.on('error',()=>{clearTimeout(timeout);resolve(-1)});});
  report.markerReturned=stdout.includes(marker);
  report.toolReferenceObserved=report.requests.some(r=>r.references.length);
  report.searchCalled=report.requests.some(r=>r.toolCalls.includes('ToolSearch'));
  report.deferredToolCalled=report.requests.some(r=>r.toolCalls.includes('mcp__bridge_fixture__read_verification_marker'));
  report.passed=report.exitCode===0&&report.markerReturned&&report.toolReferenceObserved&&report.searchCalled&&report.deferredToolCalled;
  if(!report.passed)report.diagnostic=stdout.slice(-2000).replaceAll(marker,'<marker>');
}finally{relay.closeAllConnections();relay.close();await mkdir('test-results',{recursive:true});await writeFile('test-results/tool-search.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
