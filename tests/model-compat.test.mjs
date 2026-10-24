import assert from 'node:assert/strict';
import {test} from 'node:test';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {client} from '../src/core/runtime.mjs';
import {models,selectModel} from '../src/core/catalog.mjs';
import {toResponses,resolveEffort} from '../src/core/protocol.mjs';

test('live catalog suffix and effort compatibility; prior E2E coverage', async()=>{
  const raw=await client.withAccessToken(async(token,signal)=>{
    const r=await fetch('https://api.openai.com/v1/models',{headers:{authorization:`Bearer ${token}`},signal});
    assert.equal(r.status,200); return r.json();
  });
  const catalog=await models(true), checks=[];
  for(const model of catalog){
    for(const suffix of ['','[1m]','[1M]']){
      const selected=await selectModel(model.slug+suffix);
      assert.equal(selected.slug,model.slug);
      for(const effort of model.efforts){
        const request=toResponses({model:model.slug+suffix,messages:[{role:'user',content:'Hello'}],output_config:{effort}},new Map(),selected);
        assert.equal(request.model,model.slug);assert.equal(request.reasoning.effort,effort);
      }
    }
    for(const unsupported of ['minimal','none','ultra',...['low','medium','high','xhigh','max'].filter(e=>!model.efforts.includes(e))])
      assert.throws(()=>resolveEffort({output_config:{effort:unsupported}},model.efforts),{status:400,code:'unsupported_effort'});
    checks.push({model:model.slug,suffixes:['','[1m]','[1M]'],efforts:model.efforts,contextWindow:model.contextWindow,passed:true});
  }
  await assert.rejects(selectModel('gpt-nonexistent[1m]'),{status:400,code:'model_unavailable'});
  const prior=JSON.parse(await readFile(new URL('../test-results/e2e.json',import.meta.url),'utf8'));
  for(const model of catalog)for(const mode of ['text','tools'])assert(prior.cases.some(c=>c.model===model.slug&&c.mode===mode&&c.passed));
  assert(prior.effortConfirmation.every(c=>c.passed));
  const contextMetadata=raw.models.filter(m=>m.visibility==='list').map(m=>Object.fromEntries(Object.entries(m).filter(([k])=>/slug|context|window|token/.test(k))));
  const report={date:new Date().toISOString(),checks,contextMetadata,priorE2E:{date:prior.date,cases:prior.cases.length,allPassed:prior.cases.every(c=>c.passed),effortConfirmation:prior.effortConfirmation},millionTokenRequestTested:false,warning:'[1m] selects a Claude Code client window; no evidence it enlarges the upstream account model context limit.'};
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../test-results/model-compat.json',import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify(contextMetadata));
});
