import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'bridge-key-rotation-'));
process.env.CHATGPT_BRIDGE_STATE_DIR = dir;
await writeFile(join(dir,'bridge.json'),JSON.stringify({port:0,localKey:'old-key',proxy:''}));
const { createDesktopService } = await import('../src/desktop/service.mjs');
const { config, saveConfig } = await import('../src/core/runtime.mjs');
const { createBridgeServer } = await import('../src/core/server.mjs');
test.after(()=>rm(dir,{recursive:true,force:true}));
const client={getSession:async()=>({status:'disconnected'}),cancelSignIn(){}};

test('rotation immediately revokes both API protocols without restarting the server and persists',async t=>{
  const service=createDesktopService({client,config,saveConfig,createServer:createBridgeServer});
  t.after(()=>service.invoke('stop'));
  const before=await service.invoke('start');
  const after=await service.invoke('rotateKey');
  assert.notEqual(after.apiKey,before.apiKey);
  assert.equal(after.apiKey.length,64);
  assert.equal(after.integrationNeedsReconnect,true);
  assert.equal(after.port,before.port);
  assert.equal(JSON.parse(await readFile(join(dir,'bridge.json'),'utf8')).localKey,after.apiKey);
  for(const path of ['/v1/messages/count_tokens','/v1/chat/completions','/v1/responses']) {
    const request=key=>fetch(before.anthropicURL+path,{method:'POST',headers:{authorization:`Bearer ${key}`},body:'{}'});
    assert.equal((await request(before.apiKey)).status,401);
    assert.notEqual((await request(after.apiKey)).status,401);
  }
});

test('automatic refresh defaults off; all intervals, elapsed restart, disabling and save rollback',async()=>{
  let clock=1000,saves=0,fail=false;
  const settings={localKey:'original'};
  const options={client,config:settings,now:()=>clock,saveConfig:async()=>{if(fail)throw Error('disk full');saves++}};
  let service=createDesktopService(options);
  clock+=1000000000;
  await service.invoke('checkKeyRotation');
  assert.equal(settings.localKey,'original');
  assert.equal(saves,0);
  for(const hours of [1,24,168]) {
    await service.invoke('setKeyRotation',{hours});
    const before=settings.localKey;
    clock+=hours*3600000-1;
    await service.invoke('checkKeyRotation');
    assert.equal(settings.localKey,before);
    clock++;
    service=createDesktopService(options); // Restart with the saved deadline already due.
    await service.invoke('checkKeyRotation');
    assert.notEqual(settings.localKey,before);
    const next=settings.localKey;
    await service.invoke('checkKeyRotation');
    assert.equal(settings.localKey,next);
  }
  await service.invoke('setKeyRotation',{hours:0});
  const before={...settings}; clock+=1000000000;
  await service.invoke('checkKeyRotation');
  assert.deepEqual(settings,before);
  await assert.rejects(service.invoke('setKeyRotation',{hours:2}));
  fail=true;
  await assert.rejects(service.invoke('rotateKey'),/disk full/);
  assert.deepEqual(settings,before);
  await assert.rejects(service.invoke('setKeyRotation',{hours:1}),/disk full/);
  assert.deepEqual(settings,before);
});

test('model refresh requests the complete fresh catalog and exposes it in status',async()=>{
  let force;
  const catalog=['gpt-6-luna','gpt-6-sol','gpt-6.1-sol','gpt-6-astra','gpt-extra'].map(slug=>({slug}));
  const service=createDesktopService({client,config:{},models:async refresh=>{force=refresh;return catalog}});
  assert.deepEqual((await service.invoke('models')).models,catalog);
  assert.equal(force,true);
  assert.deepEqual((await service.invoke('status')).models,catalog);
});
