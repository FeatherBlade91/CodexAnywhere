import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {models} from '../../src/core/catalog.mjs';
import {stateDir} from '../../src/core/runtime.mjs';
import {join} from 'node:path';
const report={date:new Date().toISOString(),platform:process.platform,arch:process.arch,cases:[]};
const catalog=await models(true);
const cases=catalog.flatMap(m=>[['text','low',m.slug],['tools','low',m.slug]]);
for(const effort of ['medium','high','xhigh','max'])cases.push(['text',effort,'gpt-6.1-sol']);
for(const args of cases){
  const result=await new Promise(resolve=>{
    const child=spawn(process.execPath,['scripts/live/smoke-claude.mjs',...args],{windowsHide:true});let output='';
    child.stdout.on('data',d=>output+=d);child.stderr.on('data',()=>{});
    child.on('exit',code=>resolve({mode:args[0],effort:args[1],model:args[2],passed:code===0,output:output.trim()}));
  });
  report.cases.push(result);console.log(JSON.stringify(result));
  await mkdir('test-results',{recursive:true});await writeFile('test-results/e2e.json',JSON.stringify(report,null,2));
}
const logs=(await readFile(join(stateDir,'server.log'),'utf8')).split(/\r?\n/).flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}}).filter(l=>l.time>=report.date);
report.effortConfirmation=['low','medium','high','xhigh','max'].map(effort=>({effort,passed:logs.some(l=>l.model==='gpt-6.1-sol'&&l.requestedEffort===effort&&l.confirmedEffort===effort)}));
await writeFile('test-results/e2e.json',JSON.stringify(report,null,2));
if(report.cases.some(c=>!c.passed)||report.effortConfirmation.some(c=>!c.passed))process.exitCode=1;
