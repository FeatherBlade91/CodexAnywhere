import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { join } from 'node:path';
if(process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
await mkdir('.tools',{recursive:true});
const assets=[];
async function download(url,path,expected) {
  try { const data=await readFile(path); if(!expected||createHash('sha256').update(data).digest('hex')===expected) return; }catch{}
  console.log('Downloading '+url);
  const res=await fetch(url,{signal:AbortSignal.timeout(900000)});
  if(!res.ok) throw new Error(`${res.status}: ${url}`);
  const length=Number(res.headers.get('content-length'));
  let data;
  if(expected && length>10_000_000 && res.headers.get('accept-ranges')==='bytes') {
    await res.body.cancel();
    const size=4*1024*1024, parts=new Array(Math.ceil(length/size));let next=0;
    await mkdir(path+'.parts',{recursive:true});
    await Promise.all(Array.from({length:8},async()=>{
      while(next<parts.length){
        const i=next++, start=i*size,end=Math.min(length-1,start+size-1), partPath=path+'.parts/'+i;
        try{const saved=await readFile(partPath);if(saved.length===end-start+1){parts[i]=saved;continue;}}catch{}
        for(let attempt=0;;attempt++)try{
          const r=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:AbortSignal.timeout(180000)});
          if(r.status!==206 || r.headers.get('content-range')!==`bytes ${start}-${end}/${length}`)throw new Error('Invalid range response');
          const part=Buffer.from(await r.arrayBuffer());if(part.length!==end-start+1)throw new Error('Incomplete range');
          await writeFile(partPath,part);parts[i]=part;console.log(`${path}: part ${i+1}/${parts.length}`);break;
        }catch(e){if(attempt>=3)throw e;}
      }
    }));
    data=Buffer.concat(parts);
  }else data=Buffer.from(await res.arrayBuffer());
  const sha=createHash('sha256').update(data).digest('hex');
  if(expected && sha!==expected) throw new Error('SHA256 verification failed: '+url);
  await mkdir(join(path,'..'),{recursive:true});
  await writeFile(path,data);
  console.log(`Verified ${path}: ${sha}`);
}
for(const [arch,version] of [['x64','v24.22.1'],['arm64','v24.22.1'],['x86','v22.23.4']]) {
  const base=`https://nodejs.org/dist/${version}`;
  const response=await fetch(base+'/SHASUMS256.txt'); if(!response.ok)throw new Error('Cannot load Node checksums');
  const sums=await response.text(); const entry=`win-${arch}/node.exe`;
  const line=sums.split('\n').find(l=>l.trim().endsWith(' '+entry));
  if(!line) throw new Error('Node runtime not available: '+entry);
  const sha=line.split(/\s+/)[0];
  await download(`${base}/${entry}`,`.tools/node-${arch}/node.exe`,sha);
  assets.push({arch,version,sha256:sha,url:`${base}/${entry}`});
  await download(`${base}/SHASUMS256.txt`,`.tools/node-${arch}/SHASUMS256.txt`);
}
await writeFile('.tools/runtime-manifest.json',JSON.stringify(assets,null,2));
await download('https://raw.githubusercontent.com/nodejs/node/v24.22.1/LICENSE','.tools/NODE-LICENSE.txt');
await download('https://raw.githubusercontent.com/nodejs/node/v22.23.4/LICENSE','.tools/NODE22-LICENSE.txt');
await download('https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-7.1.0-x64.exe','.tools/innosetup-7.1.0-x64.exe');
