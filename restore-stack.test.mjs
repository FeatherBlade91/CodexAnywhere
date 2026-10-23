import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const base=await mkdtemp(join(tmpdir(),'bridge-restore-stack-'));
process.env.CHATGPT_BRIDGE_HOME=join(base,'home');
process.env.CHATGPT_BRIDGE_STATE_DIR=join(base,'state');
process.env.CHATGPT_BRIDGE_CC_DIR=join(base,'custom-db');
const {restoreIntegration,assertRestoreReady}=await import('./integration.mjs');
const {config}=await import('./runtime.mjs');
config.integration='cc-switch';
const device=join(base,'home','.cc-switch'),live=join(base,'home','.claude','settings.json'),statePath=join(device,'live-state.json'),dbPath=join(base,'custom-db','cc-switch.db');
for(const p of [device,join(base,'home','.claude'),join(base,'custom-db')])await mkdir(p,{recursive:true});
const json=async(p,v)=>writeFile(p,JSON.stringify(v));
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const original={model:'original',env:{ANTHROPIC_BASE_URL:'https://original.invalid',ANTHROPIC_AUTH_TOKEN:'original-token',KEEP:'yes'}};
await json(join(base,'state','cc-restore.json'),{original});
await json(join(base,'state','direct-restore.json'),{original:{model:'stale-direct'},applied:{model:'original',env:{}}});
const ownModel='ccs-claude-openai--gpt-6.1-sol[1M]',otherModel='ccs-claude-other--different[1M]';
async function fixture(route='owned') {
 const db=new DatabaseSync(dbPath);db.exec('CREATE TABLE IF NOT EXISTS providers(id TEXT,app_type TEXT,meta TEXT);DELETE FROM providers');
 db.prepare('INSERT INTO providers VALUES(?,?,?)').run('owned','claude',JSON.stringify({chatgptPlanBridge:true}));
 db.prepare('INSERT INTO providers VALUES(?,?,?)').run('other','claude','{}');db.close();
 const state={version:2,unknown:{keep:true},apps:{codex:{mode:'proxy',proxy_route:'codex-other'},claude:{mode:'proxy',attached:true,proxy_route:route,contract:{version:1,key:'key'},written:{extra:true},stack:{enabled:true,members:['owned','other'],keys:{openai:'owned',other:'other',retired:'retired'},future:'keep'}}}};
 await json(statePath,state);await json(join(device,'settings.json'),{currentProviderClaude:route,unrelated:true});
 await json(live,{model:route==='owned'?ownModel:otherModel,env:{ANTHROPIC_BASE_URL:'http://127.0.0.1:15721',ANTHROPIC_AUTH_TOKEN:'PROXY_MANAGED',ANTHROPIC_MODEL:route==='owned'?ownModel:otherModel,KEEP:'edited'},modelPicker:{replaceBuiltInOptions:true,future:1,options:[{model:ownModel},{model:otherModel}]},hooks:{keep:true},effortLevel:'max'});
 return state;
}
test('owned stack route exits safely, preserving other apps, members and permanent keys',async()=>{
 const before=await fixture();const withFable=await load(live);withFable.env.ANTHROPIC_DEFAULT_FABLE_MODEL=ownModel;withFable.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME='Old bridge label';await json(live,withFable);
 await restoreIntegration();const state=await load(statePath),current=await load(live);
 assert.equal(current.env.ANTHROPIC_DEFAULT_FABLE_MODEL,undefined);assert.equal(current.env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME,undefined);
 assert.equal(state.apps.claude.mode,'direct');assert.equal(state.apps.claude.attached,false);assert.equal(state.apps.claude.proxy_route,undefined);assert.equal(state.apps.claude.contract,undefined);
 assert.deepEqual(state.apps.claude.stack.members,['other']);assert.deepEqual(state.apps.claude.stack.keys,before.apps.claude.stack.keys);assert.equal(state.apps.claude.stack.future,'keep');assert.deepEqual(state.apps.codex,before.apps.codex);assert.deepEqual(state.unknown,before.unknown);
 assert.equal(current.model,'original');assert.equal(current.env.ANTHROPIC_BASE_URL,original.env.ANTHROPIC_BASE_URL);assert.equal(current.env.ANTHROPIC_AUTH_TOKEN,original.env.ANTHROPIC_AUTH_TOKEN);assert.equal(current.env.KEEP,'edited');assert.equal(current.env.ANTHROPIC_MODEL,undefined);assert.deepEqual(current.modelPicker.options,[{model:otherModel}]);assert.equal(current.modelPicker.future,1);assert.equal(current.effortLevel,'max');assert.deepEqual(current.hooks,{keep:true});
 assert.deepEqual(await load(join(device,'settings.json')),{unrelated:true});
 const db=new DatabaseSync(dbPath);assert.deepEqual(db.prepare('SELECT id FROM providers').all().map(r=>r.id),['other']);db.close();
 assert.ok((await readdir(join(base,'state','backups'))).some(p=>p.endsWith('-restore')));
});
test('newly selected other provider retains proxy route, endpoint, model and picker settings',async()=>{
 const before=await fixture('other');await restoreIntegration();const state=await load(statePath),current=await load(live);
 assert.equal(state.apps.claude.mode,'proxy');assert.equal(state.apps.claude.attached,true);assert.equal(state.apps.claude.proxy_route,'other');assert.deepEqual(state.apps.claude.contract,before.apps.claude.contract);
 assert.equal(current.model,otherModel);assert.equal(current.env.ANTHROPIC_MODEL,otherModel);assert.equal(current.env.ANTHROPIC_AUTH_TOKEN,'PROXY_MANAGED');assert.equal(current.env.ANTHROPIC_BASE_URL,'http://127.0.0.1:15721');assert.deepEqual(current.modelPicker.options,[{model:otherModel}]);assert.equal((await load(join(device,'settings.json'))).currentProviderClaude,'other');
});
test('pending operations block restore before any mutation',async()=>{
 const state=await fixture();state.apps.claude.pending={op:'stack',files:[]};await json(statePath,state);const before=await readFile(live,'utf8');
 await assert.rejects(assertRestoreReady(),/pending/);await assert.rejects(restoreIntegration(),/pending/);assert.equal(await readFile(live,'utf8'),before);assert.deepEqual(await load(statePath),state);
 const db=new DatabaseSync(dbPath);assert.equal(db.prepare('SELECT count(*) n FROM providers').get().n,2);db.close();
});
