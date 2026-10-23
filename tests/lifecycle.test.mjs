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
  const child=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
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

test('isolated lifecycle: shutdown rejects missing/wrong keys and authenticated shutdown drains naturally',{timeout:20000},async t=>{
  const f=await fixture(t);
  for(const headers of [{},{authorization:'Bearer wrong-key'}]){
    const r=await fetch(f.base+'/admin/shutdown',{method:'POST',headers});
    assert.equal(r.status,401);assert.equal((await r.json()).error.type,'authentication_error');
    const health=await fetch(f.base+'/health');assert.equal(health.status,200);await health.text();
  }
  const stopped=await fetch(f.base+'/admin/shutdown',{method:'POST',headers:{authorization:`Bearer ${f.localKey}`}});
  assert.equal(stopped.status,202);assert.equal((await stopped.json()).status,'draining');
  assert.deepEqual(await expectExit(f.exited),{code:0,signal:null});
});

test('stop.ps1 stops only the explicitly spawned isolated server gracefully',{timeout:30000,skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);
  const ps=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'stop.ps1')],{cwd:root,env:f.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';ps.stdout.on('data',d=>output+=d);ps.stderr.on('data',d=>output+=d);
  t.after(()=>{if(ps.exitCode===null&&ps.signalCode===null)ps.kill()});
  const status=await new Promise((resolve,reject)=>{ps.once('error',reject);ps.once('exit',resolve)});
  assert.equal(status,0,output);assert.deepEqual(await expectExit(f.exited),{code:0,signal:null});
});
