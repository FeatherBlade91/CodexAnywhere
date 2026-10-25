import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const state = await mkdtemp(join(tmpdir(), 'desktop-service-'));
process.env.CHATGPT_BRIDGE_STATE_DIR = state;
await writeFile(join(state, 'bridge.json'), JSON.stringify({port:0,localKey:'test',model:'first',proxy:''}));
const {createDesktopService} = await import('../src/desktop/service.mjs');
process.on('exit', () => {});
test.after(() => rm(state, {recursive:true,force:true}));
function fixture() {
  let cancel, integrates = 0;
  const config = {port:0, localKey:'test',model:'first',proxy:''};
  const client = {getSession:async()=>({status:'disconnected',sharing:false}), cancelSignIn:()=>cancel?.(),
    signIn:()=>new Promise((resolve,reject)=>{cancel=()=>reject(Error('Cancelled'));}), disconnect:async()=>{}};
  const service = createDesktopService({config,client,saveConfig:async()=>{}, models:async()=>[{slug:'first'},{slug:'second'}],
    createServer:()=>createServer((req,res)=>res.end('ok')), integration:{configure:async()=>{integrates++},syncModels:async()=>{integrates++}}});
  return {service, config, integrates:()=>integrates};
}
test('model discovery and selection never apply an integration', async()=>{
  const f=fixture();
  assert.equal((await f.service.invoke('models')).models.length,2);
  await f.service.invoke('selectModel',{model:'second'});
  assert.equal(f.config.model,'second'); assert.equal(f.integrates(),0);
  await assert.rejects(f.service.invoke('selectModel',{model:'missing'}));
  await f.service.invoke('integrate',{mode:'direct'}); assert.equal(f.integrates(),2);
});
test('status and cancellation remain usable while sign-in is pending', async()=>{
  const f=fixture(); const login=f.service.invoke('login');
  const rejected=assert.rejects(login,/Cancelled/);
  assert.equal((await f.service.invoke('status')).session.status,'connecting');
  assert.equal((await f.service.invoke('cancelLogin')).session.status,'disconnected'); await rejected;
});

test('connection diagnostics inspect the current local listener without login or model generation', async t => {
  const config = { port: 0, localKey: 'private-key', proxy: 'http://127.0.0.1:7890' };
  const observed = [];
  const service = createDesktopService({ config, saveConfig: async () => {},
    client: { getSession: async () => ({ status: 'disconnected' }), cancelSignIn() {}, signIn: () => assert.fail('diagnostics must not sign in') },
    models: () => assert.fail('diagnostics must not request models through the account'),
    createServer: () => createServer(),
    testConnection: async options => {
      assert.equal(options.proxy, config.proxy);
      assert.equal('apiKey' in options, false);
      return { ok: true, generationTested: false, localBridge: await options.inspectBridge() };
    },
    inspectLocalBridge: async state => { observed.push(state); return { ok: state.running }; },
  });
  t.after(() => service.invoke('stop'));
  assert.equal((await service.invoke('testConnection')).connection.localBridge.ok, false);
  await service.invoke('start');
  const result = await service.invoke('testConnection');
  assert.equal(result.connection.localBridge.ok, true);
  assert.deepEqual(observed, [{ port: 0, running: false }, { port: result.port, running: true }]);
});

test('failed proxy save restores the previous configured and active route', async () => {
  const previous = 'http://127.0.0.1:7890';
  const config = { port: 0, proxy: previous };
  const applied = [];
  const service = createDesktopService({ config,
    client: { getSession: async () => ({ status: 'disconnected' }) },
    applyProxy: value => applied.push(value),
    saveConfig: async () => { throw new Error('Cannot save settings'); },
  });
  await assert.rejects(service.invoke('setProxy', { proxy: '' }), /Cannot save settings/);
  assert.equal(config.proxy, previous);
  assert.deepEqual(applied, ['', previous]);
  assert.equal((await service.invoke('status')).proxy, previous);
});
test('start and stop are idempotent and serialize concurrent requests', async()=>{
  const f=fixture();
  const results=await Promise.all([f.service.invoke('start'),f.service.invoke('start'),f.service.invoke('stop')]);
  assert.equal(results[0].running,true); assert.equal(results[1].running,true); assert.equal(results[2].running,false);
  assert.equal((await f.service.invoke('stop')).running,false);
});
test('failed integration restores previous configured mode', async()=>{
  const config={port:0,localKey:'test',model:'first',integration:'direct'};
  const service=createDesktopService({config,client:{getSession:async()=>({status:'disconnected'})},saveConfig:async()=>{},models:async()=>[{slug:'first'}],
    integration:{configure:async mode=>{config.integration=mode},syncModels:async()=>{throw Error('Database busy')}}});
  await assert.rejects(service.invoke('integrate',{mode:'cc-switch'}),/Database busy/);
  assert.equal(config.integration,'direct');
});
test('explicit model selection updates an existing integration', async()=>{
  const config={port:0,localKey:'test',model:'first',integration:'direct'}; let applied;
  const service=createDesktopService({config,client:{getSession:async()=>({status:'connected',sharing:true})},saveConfig:async()=>{},models:async()=>[{slug:'first'},{slug:'second'}],
    integration:{syncModels:async()=>{applied=config.model}}});
  await service.invoke('selectModel',{model:'second'}); assert.equal(applied,'second');
});
test('sign-in queued behind a mutation can be cancelled before opening browser', async()=>{
  let release, logins=0;
  const client={getSession:async()=>({status:'disconnected'}),cancelSignIn:()=>{},signIn:async()=>{logins++;return {sharing:true}}};
  const service=createDesktopService({client,config:{port:0,localKey:'test'},models:()=>new Promise(resolve=>{release=()=>resolve([])})});
  const discovery=service.invoke('models'); await new Promise(resolve=>setImmediate(resolve));
  const login=service.invoke('login'); const failure=assert.rejects(login);
  const cancelled=service.invoke('cancelLogin'); release(); await discovery; await cancelled; await failure;
  assert.equal(logins,0);
});
test('port conflict selects and persists a reachable port and refreshes integration', async t=>{
  const occupied=createServer(); await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const previous=occupied.address().port, config={port:previous,localKey:'test',integration:'direct'};
  let saved, updated;
  const service=createDesktopService({config,client:{getSession:async()=>({status:'disconnected'}),cancelSignIn(){}},
    saveConfig:async()=>{saved=config.port},integration:{updatePort:async old=>{updated=[old,config.port]}},
    createServer:()=>createServer((req,res)=>res.end('ok'))});
  t.after(()=>service.invoke('stop'));
  const result=await service.invoke('start');
  assert.notEqual(result.port,previous); assert.equal(saved,result.port);
  assert.deepEqual(updated,[previous,result.port]);
  assert.equal(await (await fetch(result.baseURL)).text(),'ok');
  await service.invoke('stop'); assert.equal((await service.invoke('start')).port,result.port);
});

test('failed port synchronization closes listener and restores saved port', async t=>{
  const occupied=createServer(); await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  const previous=occupied.address().port, config={port:previous,integration:'direct'};
  let allocated;
  const service=createDesktopService({config,client:{getSession:async()=>({status:'disconnected'})},saveConfig:async()=>{},
    integration:{updatePort:async()=>{allocated=config.port;throw Error('Cannot update client')}},createServer:()=>createServer()});
  await assert.rejects(service.invoke('start'),/Cannot update client/);
  assert.equal(config.port,previous); assert.equal((await service.invoke('status')).running,false);
  const probe=createServer(); await new Promise((resolve,reject)=>probe.once('error',reject).listen(allocated,'127.0.0.1',resolve));
  await new Promise(resolve=>probe.close(resolve));
});
