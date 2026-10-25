import { modelMapping } from './model-mapping.mjs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { DatabaseSync, backup } from 'node:sqlite';
import { root, stateDir, config, saveConfig } from './runtime.mjs';

export const userHome = process.env.CHATGPT_BRIDGE_HOME || homedir();
const readJson = async (path, fallback) => {
  try { return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,'')); }
  catch(e) { if(e.code==='ENOENT') return fallback; throw e; }
};
export async function ccDirectory() {
  if (process.env.CHATGPT_BRIDGE_CC_DIR) return process.env.CHATGPT_BRIDGE_CC_DIR;
  const paths = await readJson(join(process.env.APPDATA,'com.ccswitch.desktop','app_paths.json'), {});
  const custom = paths.app_config_dir_override;
  if (typeof custom === 'string' && custom.trim()) {
    const p = custom.replace(/^~(?=[/\\]|$)/, userHome);
    if (existsSync(p)) return p;
    throw new Error('CC Switch custom configuration directory is unavailable.');
  }
  return join(userHome,'.cc-switch');
}
export function providerId() { return config.providerId || 'chatgpt-plan-local'; }
export function providerSettings() {
  const mapping = modelMapping(config);
  const slug = mapping.sonnet;
  return { model: slug, env: {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.port}`, ANTHROPIC_AUTH_TOKEN: config.localKey,
    ANTHROPIC_MODEL: slug, ANTHROPIC_REASONING_MODEL: slug,
    ANTHROPIC_DEFAULT_SONNET_MODEL: mapping.sonnet, ANTHROPIC_DEFAULT_OPUS_MODEL: mapping.opus, ANTHROPIC_DEFAULT_HAIKU_MODEL: mapping.haiku,
    ANTHROPIC_DEFAULT_FABLE_MODEL: mapping.fable,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }};
}
async function snapshot() {
  const directory=join(stateDir,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(directory,{recursive:true});
  const live=join(userHome,'.claude','settings.json');
  const existing=await readJson(live,{});
  await writeFile(join(directory,'claude-settings.json'),JSON.stringify(existing,null,2));
  return {directory,live,existing};
}
export async function configure(mode) {
  if(!['cc-switch','direct'].includes(mode)) throw new Error('Choose cc-switch or direct integration.');
  if(mode==='cc-switch' && !existsSync(join(await ccDirectory(),'cc-switch.db'))) throw new Error('Start CC Switch once to initialize its configuration, then retry.');
  config.integration=mode; config.installDir=root; await saveConfig();
}
export async function updatePort(previousPort) {
  const before = `http://127.0.0.1:${previousPort}`;
  const after = `http://127.0.0.1:${config.port}`;
  const { directory, live, existing } = await snapshot();
  if (config.integration === 'direct') {
    if (existing.env?.ANTHROPIC_BASE_URL !== before || existing.env?.ANTHROPIC_AUTH_TOKEN !== config.localKey) return;
    const restorePath = join(stateDir, 'direct-restore.json');
    const restore = await readJson(restorePath, null);
    existing.env.ANTHROPIC_BASE_URL = after;
    if (restore?.applied?.env?.ANTHROPIC_BASE_URL === before) {
      restore.applied.env.ANTHROPIC_BASE_URL = after;
      await writeFile(restorePath, JSON.stringify(restore, null, 2));
    }
    try { await writeFile(live, JSON.stringify(existing, null, 2)); }
    catch (error) {
      if (restore?.applied?.env?.ANTHROPIC_BASE_URL === after) {
        restore.applied.env.ANTHROPIC_BASE_URL = before;
        await writeFile(restorePath, JSON.stringify(restore, null, 2));
      }
      throw error;
    }
  } else if (config.integration === 'cc-switch') {
    const dbPath = join(await ccDirectory(), 'cc-switch.db');
    if (!existsSync(dbPath)) throw new Error('CC Switch database was not found.');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA busy_timeout=15000');
      await backup(db, join(directory, 'cc-switch.db'));
      db.exec('BEGIN IMMEDIATE');
      const rows = db.prepare("SELECT id,settings_config FROM providers WHERE app_type='claude' AND json_extract(meta,'$.chatgptPlanBridge')=1").all();
      for (const row of rows) {
        const settings = JSON.parse(row.settings_config);
        if (settings.env?.ANTHROPIC_BASE_URL !== before || settings.env?.ANTHROPIC_AUTH_TOKEN !== config.localKey) continue;
        settings.env.ANTHROPIC_BASE_URL = after;
        db.prepare("UPDATE providers SET settings_config=? WHERE id=? AND app_type='claude'").run(JSON.stringify(settings), row.id);
      }
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  }
}
export async function syncModels(catalog) {
  if (!catalog.length) throw new Error('No available models to register.');
  const {directory,live,existing}=await snapshot();
  const mode=config.integration || 'cc-switch';
  if(mode==='cc-switch') {
    const dbPath=join(await ccDirectory(),'cc-switch.db');
    if(!existsSync(dbPath)) throw new Error('CC Switch database was not found. Start CC Switch once first.');
    const restorePath=join(stateDir,'cc-restore.json');
    if(!existsSync(restorePath)) {
      const original=structuredClone(existing);
      // An upgrade from an earlier bridge must not restore a removed bridge endpoint.
      if(original.env?.ANTHROPIC_BASE_URL===`http://127.0.0.1:${config.port}`) {
        for(const key of Object.keys(providerSettings(config.model).env)) delete original.env[key];
        delete original.model;
      }
      await writeFile(restorePath,JSON.stringify({original},null,2));
    }
    const db=new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA busy_timeout=15000');
      await backup(db,join(directory,'cc-switch.db'));
      db.exec('BEGIN IMMEDIATE');
      const owned=db.prepare("SELECT id,is_current FROM providers WHERE app_type='claude' AND json_extract(meta,'$.chatgptPlanBridge')=1").all();
      // Retain the selected legacy row ID so CC Switch's route references remain valid.
      config.providerId=owned.find(p=>p.is_current)?.id || owned.find(p=>p.id===config.providerId)?.id || owned[0]?.id || providerId();
      const mapping=modelMapping(config);
      const ordered=Object.entries(mapping).map(([role,slug])=>({slug,displayName:`${role} · ${slug}`}));
      const stmt=db.prepare(`INSERT INTO providers (id,app_type,name,settings_config,website_url,category,created_at,sort_index,notes,icon,meta,is_current)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id,app_type) DO UPDATE SET name=excluded.name,settings_config=excluded.settings_config,notes=excluded.notes,meta=excluded.meta,sort_index=excluded.sort_index`);
      stmt.run(providerId(),'claude','Codex-Anywhere',JSON.stringify(providerSettings()),
        'https://learn.chatgpt.com/cookbook/articles/sign-in-with-chatgpt','custom',Date.now(),0,
        `官方订阅授权 · ${ordered.length} 个模型 · 在聚合模式 /model 中切换。由 Codex-Anywhere 刷新模型；effort 原样传递。`,
        'openai',JSON.stringify({apiFormat:'anthropic',commonConfigEnabled:false,endpointAutoSelect:false,chatgptPlanBridge:true,
          stackModels:ordered.map(m=>({model:m.slug,displayName:m.displayName,oneM:true}))}));
      db.prepare("DELETE FROM providers WHERE app_type='claude' AND json_extract(meta,'$.chatgptPlanBridge')=1 AND id<>?").run(providerId());
      db.exec('COMMIT');
      await saveConfig();
    } catch(e) { try {db.exec('ROLLBACK');}catch{} throw e; } finally {db.close();}
  } else {
    const mapping=modelMapping(config);
    const applied=providerSettings();
    applied.model='sonnet';
    for(const key of Object.keys(applied.env)) if(key==='ANTHROPIC_MODEL'||key==='ANTHROPIC_REASONING_MODEL'||/^ANTHROPIC_DEFAULT_.*_MODEL$/.test(key)) applied.env[key]+='[1M]';
    applied.modelPicker={replaceBuiltInOptions:true,options:Object.entries(mapping).map(([role,slug])=>({model:role,label:role,description:slug}))};
    await mkdir(dirname(live),{recursive:true});
    const restorePath=join(stateDir,'direct-restore.json');
    const restore=await readJson(restorePath,{original:existing});
    restore.applied=applied;
    await writeFile(restorePath,JSON.stringify(restore,null,2));
    await writeFile(live,JSON.stringify({...existing,model:applied.model,modelPicker:applied.modelPicker,env:{...existing.env,...applied.env}},null,2));
    await saveConfig();
  }
  return {mode,count:catalog.length,providerCount:1,backup:directory};
}
export async function assertRestoreReady() {
  const dbPath=join(await ccDirectory(),'cc-switch.db');
  const deviceDir=join(userHome,'.cc-switch');
  const state=await readJson(join(deviceDir,'live-state.json'),{});
  if(state.apps?.claude?.pending) throw new Error('CC Switch has a pending Claude operation. Start CC Switch to recover it, then exit CC Switch before restoring.');
  const isolated=process.env.CHATGPT_BRIDGE_CC_DIR && resolve(userHome)!==resolve(homedir());
  if(existsSync(dbPath) && process.platform==='win32' && !isolated) {
    const processes=execFileSync('tasklist.exe',['/FI','IMAGENAME eq cc-switch.exe','/FO','CSV','/NH'],{encoding:'utf8',windowsHide:true});
    if(/"cc-switch\.exe"/i.test(processes)) throw new Error('Exit CC Switch completely (including the tray icon), then retry restore/uninstall. No configuration has been changed.');
  }
  return {ready:true};
}
export async function restoreIntegration() {
  await assertRestoreReady();
  const restore=await readJson(join(stateDir,'direct-restore.json'),null);
  if(restore && config.integration==='direct') {
    const live=join(userHome,'.claude','settings.json');
    const current=await readJson(live,{});
    for(const [key,value] of Object.entries(restore.applied.env)) {
      if(current.env?.[key]===value) {
        if(restore.original.env?.[key]===undefined) delete current.env[key];
        else current.env[key]=restore.original.env[key];
      }
    }
    if(current.model===restore.applied.model) {
      if(restore.original.model===undefined) delete current.model; else current.model=restore.original.model;
    }
    if(restore.applied.modelPicker && JSON.stringify(current.modelPicker)===JSON.stringify(restore.applied.modelPicker)) {
      if(restore.original.modelPicker===undefined) delete current.modelPicker; else current.modelPicker=restore.original.modelPicker;
    }
    await writeFile(live,JSON.stringify(current,null,2));
  }
  const dbPath=join(await ccDirectory(),'cc-switch.db');
  if(existsSync(dbPath)) {
    const db=new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA busy_timeout=15000');
      const owned=db.prepare("SELECT id FROM providers WHERE app_type='claude' AND json_extract(meta,'$.chatgptPlanBridge')=1").all();
      const ids=new Set(owned.map(p=>p.id));
      const deviceDir=join(userHome,'.cc-switch');
      const paths=[join(userHome,'.claude','settings.json'),join(deviceDir,'settings.json'),join(deviceDir,'live-state.json')];
      const raw=await Promise.all(paths.map(async p=>{try{return await readFile(p,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}}));
      const [current,ccSettings,state]=raw.map(s=>s===null?{}:JSON.parse(s.replace(/^\uFEFF/,'')));
      const app=state.apps?.claude;
      const keys=Object.entries(app?.stack?.keys || {}).filter(([,id])=>ids.has(id)).map(([key])=>key);
      const ownedModel=value=>typeof value==='string' && keys.some(key=>value.startsWith(`ccs-claude-${key}--`));
      const activeRoute=app?.mode==='proxy' && ids.has(app?.proxy_route);
      const directOwned=current.env?.ANTHROPIC_BASE_URL===`http://127.0.0.1:${config.port}` && current.env?.ANTHROPIC_AUTH_TOKEN===config.localKey;
      const ccRestore=await readJson(join(stateDir,'cc-restore.json'),null);
      const original=ccRestore?.original || {};
      const setOriginal=(object,key,source)=>{if(source?.[key]===undefined)delete object[key];else object[key]=structuredClone(source[key]);};
      // Identify models by the immutable stack key registry, never by vendor name.
      if(Array.isArray(current.modelPicker?.options)) {
        current.modelPicker.options=current.modelPicker.options.filter(option=>!ownedModel(option.model));
        if(!current.modelPicker.options.length) {
          current.modelPicker.options=structuredClone(original.modelPicker?.options || []);
          current.modelPicker.replaceBuiltInOptions=original.modelPicker?.replaceBuiltInOptions ?? false;
        }
      }
      if(activeRoute || directOwned) {
        current.env ||= {};
        for(const key of Object.keys(providerSettings(config.model).env)) {
          const value=current.env[key];
          const isConnection=key==='ANTHROPIC_BASE_URL'||key==='ANTHROPIC_AUTH_TOKEN';
          const isLocalProxy=isConnection && current.env.ANTHROPIC_AUTH_TOKEN==='PROXY_MANAGED';
          if(directOwned || ownedModel(value) || isLocalProxy || (key==='CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' && value==='1')) {
            if(ownedModel(value) && key.endsWith('_MODEL')) setOriginal(current.env,key+'_NAME',original.env);
            setOriginal(current.env,key,original.env);
          }
        }
        for(const [key,value] of Object.entries(current.env)) if(ownedModel(value)) {
          setOriginal(current.env,key,original.env);
          if(key.endsWith('_MODEL')) setOriginal(current.env,key+'_NAME',original.env);
        }
        if(directOwned || ownedModel(current.model)) setOriginal(current,'model',original);
      } else {
        // Another provider is active: keep its endpoint, mode and selection.
        for(const [key,value] of Object.entries(current.env || {})) if(ownedModel(value)) delete current.env[key];
        if(ownedModel(current.model)) delete current.model;
      }
      if(app?.stack?.members) app.stack.members=app.stack.members.filter(id=>!ids.has(id));
      if(activeRoute) {app.mode='direct';app.attached=false;delete app.proxy_route;delete app.contract;}
      if(ids.has(ccSettings.currentProviderClaude)) delete ccSettings.currentProviderClaude;
      const updated=[current,ccSettings,state];
      const directory=join(stateDir,'backups',new Date().toISOString().replace(/[:.]/g,'-')+'-restore');
      await mkdir(directory,{recursive:true});
      await backup(db,join(directory,'cc-switch.db'));
      for(let i=0;i<paths.length;i++) if(raw[i]!==null) await writeFile(join(directory,['claude-settings.json','cc-settings.json','live-state.json'][i]),raw[i]);
      await assertRestoreReady();
      db.exec('BEGIN IMMEDIATE');
      // Optimistic checks prevent overwriting changes made while preparing backups.
      for(let i=0;i<paths.length;i++) {
        let latest=null;try{latest=await readFile(paths[i],'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
        if(latest!==raw[i]) throw new Error('Configuration changed during restore. Close CC Switch and Claude Code, then retry.');
      }
      for(let i=0;i<paths.length;i++) if(raw[i]!==null && JSON.stringify(JSON.parse(raw[i].replace(/^\uFEFF/,'')))!==JSON.stringify(updated[i])) {
        const staged=paths[i]+`.bridge-restore-${process.pid}.tmp`;
        await writeFile(staged,JSON.stringify(updated[i],null,2));await rename(staged,paths[i]);
      }
      db.prepare("DELETE FROM providers WHERE app_type='claude' AND json_extract(meta,'$.chatgptPlanBridge')=1").run();
      db.exec('COMMIT');
    } catch(e) {try{db.exec('ROLLBACK')}catch{}throw e} finally {db.close();}
  }
  return {restored:true};
}
