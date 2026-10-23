import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const base=await mkdtemp(join(tmpdir(),'bridge-detect-中文-'));
const appdata=join(base,'roaming'), local=join(base,'local'), custom=join(base,"数据库 with spaces 'quotes'");
await mkdir(join(appdata,'com.ccswitch.desktop'),{recursive:true});await mkdir(custom,{recursive:true});
const env={...process.env,APPDATA:appdata,LOCALAPPDATA:local,ProgramFiles:join(base,'programs'),ProgramW6432:join(base,'programs64')};
const script=resolve('detect-cc.ps1');
function check(name,expected,overrides={}) {
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{env:{...env,...overrides},encoding:'utf8',windowsHide:true});
  assert.equal(r.status,expected,name+': '+r.stderr);console.log('PASS: '+name);
}
check('missing explicit database',1,{CHATGPT_BRIDGE_CC_DIR:join(base,'absent')});
const db=new DatabaseSync(join(custom,'cc-switch.db'));db.exec('CREATE TABLE providers(id TEXT)');db.close();
check('explicit initialized directory',0,{CHATGPT_BRIDGE_CC_DIR:custom});
await writeFile(join(appdata,'com.ccswitch.desktop','app_paths.json'),'\uFEFF'+JSON.stringify({app_config_dir_override:custom}));
check('BOM JSON custom directory with Chinese, spaces and quotes',0,{CHATGPT_BRIDGE_CC_DIR:''});
await writeFile(join(appdata,'com.ccswitch.desktop','app_paths.json'),JSON.stringify({app_config_dir_override:join(base,'uninitialized')}));
check('configured but uninitialized directory',2,{CHATGPT_BRIDGE_CC_DIR:''});
await writeFile(join(custom,'cc-switch.db'),'corrupt');
check('invalid database header',3,{CHATGPT_BRIDGE_CC_DIR:custom});
await writeFile(join(appdata,'com.ccswitch.desktop','app_paths.json'),'{invalid');
check('invalid app paths JSON',3,{CHATGPT_BRIDGE_CC_DIR:''});
