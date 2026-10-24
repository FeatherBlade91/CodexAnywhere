import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
async function freePort(){
  const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));return port;
}
async function fixture(t){
  const state=await mkdtemp(join(tmpdir(),'bridge-lifecycle-'));
  const port=await freePort(),localKey=randomBytes(32).toString('hex');
  await writeFile(join(state,'bridge.json'),JSON.stringify({port,localKey,proxy:'',model:'gpt-6.1-sol'}));
  const env={...process.env,CHATGPT_BRIDGE_STATE_DIR:state};
  const child=spawn(process.execPath,[join(root,'src/core/server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let diagnostic='';child.stdout.on('data',d=>diagnostic+=d);child.stderr.on('data',d=>diagnostic+=d);
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}))});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill()});
  await writeFile(join(state,'server.pid'),String(child.pid));
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error(`Isolated server exited before readiness: ${diagnostic}`);
    try {const r=await fetch(base+'/health',{signal:AbortSignal.timeout(500)});if(r.ok){assert.equal((await r.json()).installDir,root);ready=true;break}}catch{}
    await delay(100);
  }
  assert(ready,'Isolated server becomes healthy');
  return{base,localKey,env,child,exited};
}
async function expectExit(exited){
  let timer;
  try{return await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Server did not naturally exit within 10s')),10000)})])}
  finally{clearTimeout(timer)}
}

test('standalone unified server authenticates both protocols and has no HTTP admin controls', {timeout:20000}, async t => {
  const f = await fixture(t);
  for (const path of ['/v1/messages', '/v1/chat/completions', '/v1/responses']) {
    const response = await fetch(f.base + path, {method:'POST', body:'{}'});
    assert.equal(response.status,401);
    await response.text();
  }
  const response = await fetch(f.base + '/admin/shutdown', {method:'POST', headers:{authorization:`Bearer ${f.localKey}`}});
  assert.equal(response.status,404); await response.text();
  assert.equal((await fetch(f.base + '/health')).status,200);
  f.child.kill(); await expectExit(f.exited);
});
