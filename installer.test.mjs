import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
const base=await mkdtemp(join(tmpdir(),'bridge-install-中文-'));
const env={...process.env,CHATGPT_BRIDGE_TEST_INSTANCE:'test-'+randomUUID(),CHATGPT_BRIDGE_STATE_DIR:join(base,'state'),CHATGPT_BRIDGE_HOME:join(base,'home'),CHATGPT_BRIDGE_CC_DIR:join(base,'cc'),NODE_NO_WARNINGS:'1'};
await mkdir(join(base,'home','.claude'),{recursive:true});
const live=join(base,'home','.claude','settings.json');
const original={model:'original',env:{KEEP:'yes',ANTHROPIC_BASE_URL:'https://example.invalid'},hooks:{keep:true}};
await writeFile(live,JSON.stringify(original));
const exe=resolve('dist/ChatGPT-Plan-Bridge-Setup-1.0.0.exe'),dest=join(base,'安装目录 with spaces');
const result={date:new Date().toISOString(),platform:process.platform,arch:process.arch,artifact:{name:'ChatGPT-Plan-Bridge-Setup-1.0.0.exe',sha256:createHash('sha256').update(await readFile(exe)).digest('hex')},cases:[]};
async function run(exe,args,cwd=base){return new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd,env,windowsHide:true});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);const timer=setTimeout(()=>{child.kill();reject(new Error('Installer test timeout'))},180000);child.on('exit',code=>{clearTimeout(timer);resolve({code,output})})})}
async function setup(mode,extra=[]){return run(exe,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=!startup,!desktopicon',`/DIR=${dest}`,`/MODE=${mode}`,`/LOG=${join(base,'setup-'+result.cases.length+'.log')}`,...extra])}
function pass(name){result.cases.push({name,passed:true});console.log('PASS: '+name)}
let r=await setup('direct');assert.notEqual(r.code,0);pass('silent direct mode requires explicit overwrite consent');
r=await setup('cc-switch');assert.notEqual(r.code,0);pass('missing CC Switch blocks CC mode before installation');
r=await setup('direct',['/ACCEPTCONFIGOVERWRITE=1']);assert.equal(r.code,0,JSON.stringify(r));pass('direct install to Chinese path with spaces');
const node=join(dest,'runtime','node.exe');
const fixture="const {syncModels}=await import('./integration.mjs');await syncModels([{slug:'gpt-6.1-sol',displayName:'GPT-6.1 Sol',efforts:['low','high','max']}]);";
r=await run(node,['--input-type=module','-e',fixture],dest);assert.equal(r.code,0,r.output);
assert.equal(JSON.parse(await readFile(live,'utf8')).env.KEEP,'yes');pass('installed bundled runtime writes direct settings with backup');
r=await run(join(dest,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/RESTORE=1']);assert.equal(r.code,0,r.output);
assert.deepEqual(JSON.parse(await readFile(live,'utf8')),original);pass('direct uninstall restores original settings');
await mkdir(env.CHATGPT_BRIDGE_CC_DIR,{recursive:true});const db=new DatabaseSync(join(env.CHATGPT_BRIDGE_CC_DIR,'cc-switch.db'));
db.exec('CREATE TABLE providers(id TEXT, app_type TEXT, name TEXT, settings_config TEXT, website_url TEXT, category TEXT, created_at INTEGER,sort_index INTEGER,notes TEXT,icon TEXT,meta TEXT,is_current INTEGER,PRIMARY KEY(id,app_type))');
db.prepare('INSERT INTO providers(id,app_type,name,is_current,meta) VALUES(?,?,?,?,?)').run('existing','claude','Existing',1,'{}');db.close();
r=await setup('cc-switch');assert.equal(r.code,0,JSON.stringify(r));pass('CC Switch mode installs with initialized database');
r=await run(node,['--input-type=module','-e',fixture],dest);assert.equal(r.code,0,r.output);assert.deepEqual(JSON.parse(await readFile(live,'utf8')),original);pass('CC mode registration preserves live Claude settings');
r=await run(join(dest,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/RESTORE=1']);assert.equal(r.code,0,r.output);
const end=new DatabaseSync(join(env.CHATGPT_BRIDGE_CC_DIR,'cc-switch.db'));assert.equal(end.prepare('SELECT COUNT(*) AS n FROM providers').get().n,1);end.close();pass('CC uninstall removes only owned provider');
await mkdir('test-results',{recursive:true});await writeFile('test-results/installer.json',JSON.stringify(result,null,2));
console.log('Installer validation complete. Temporary test data: '+base);
