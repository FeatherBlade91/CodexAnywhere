import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const base=await mkdtemp(join(tmpdir(),'bridge-integration-'));
process.env.CHATGPT_BRIDGE_STATE_DIR=join(base,'state');
process.env.CHATGPT_BRIDGE_HOME=join(base,'home');
process.env.CHATGPT_BRIDGE_CC_DIR=join(base,'cc');
const {configure,syncModels,restoreIntegration,providerSettings}=await import('./integration.mjs');
const {config}=await import('./runtime.mjs');
const live=join(base,'home','.claude','settings.json');
const catalog=[{slug:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',efforts:['low','medium','high','xhigh','max']},{slug:'gpt-6-luna',displayName:'GPT-6 Luna',efforts:['low','high']}];
await mkdir(join(base,'home','.claude'),{recursive:true});
const original={env:{ANTHROPIC_BASE_URL:'https://example.invalid',KEEP:'yes'},model:'original',hooks:{preserve:true},effortLevel:'max'};
await writeFile(live,JSON.stringify(original));
const load=async()=>JSON.parse(await readFile(live,'utf8'));
test('direct mode preserves unrelated settings and restores only owned values',async()=>{
 await configure('direct');await syncModels(catalog);let value=await load();
 assert.equal(value.env.KEEP,'yes');assert.equal(value.effortLevel,'max');assert.deepEqual(value.hooks,original.hooks);
 value.env.USER_EDIT='keep';await writeFile(live,JSON.stringify(value));await restoreIntegration();
 assert.deepEqual(await load(),{...original,env:{...original.env,USER_EDIT:'keep'}});
});
test('missing CC database is rejected without changing live settings',async()=>{
 const before=await load();await assert.rejects(configure('cc-switch'),/Start CC Switch/);assert.deepEqual(await load(),before);
});
test('CC registration is idempotent, nonnegative, preserves other providers and restores selected live config',async()=>{
 await mkdir(join(base,'cc'),{recursive:true});const db=new DatabaseSync(join(base,'cc','cc-switch.db'));
 db.exec('CREATE TABLE providers(id TEXT, app_type TEXT, name TEXT, settings_config TEXT, website_url TEXT, category TEXT, created_at INTEGER,sort_index INTEGER,notes TEXT,icon TEXT,meta TEXT,is_current INTEGER,PRIMARY KEY(id,app_type))');
 db.prepare('INSERT INTO providers(id,app_type,name,is_current,meta) VALUES(?,?,?,?,?)').run('existing','claude','Existing',1,'{}');db.close();
 await configure('cc-switch');await syncModels(catalog);await syncModels(catalog);
 const check=new DatabaseSync(join(base,'cc','cc-switch.db'));const rows=check.prepare('SELECT * FROM providers').all();check.close();
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id==='existing').is_current,1);assert.ok(rows.filter(r=>r.id!=='existing').every(r=>r.sort_index>=0));
 assert.equal(JSON.parse(rows.find(r=>r.id!=='existing').meta).stackModels.length,2);
 const before=await load();const applied=providerSettings(catalog[0].slug);await writeFile(live,JSON.stringify({...before,model:applied.model,env:{...before.env,...applied.env}}));
 await restoreIntegration();assert.deepEqual(await load(),before);
 const end=new DatabaseSync(join(base,'cc','cc-switch.db'));assert.equal(end.prepare('SELECT COUNT(*) AS n FROM providers').get().n,1);end.close();
});
