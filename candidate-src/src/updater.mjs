import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const sha256 = b=>crypto.createHash('sha256').update(b).digest('hex');
const safePath = p => {
  if(typeof p!=='string' || !p || p.includes('\\') || path.posix.isAbsolute(p) ||
    p.split('/').some(s=>!s || s==='.' || s==='..') || /^[a-z]:/i.test(p)) {
    throw new Error('Unsafe update file path: '+p);
  }
  return p;
};
function newer(a,b){
  const va=String(a).split('.').map(x=>Number(x)||0), vb=String(b).split('.').map(x=>Number(x)||0);
  for(let i=0;i<Math.max(va.length,vb.length);i++){
    if((va[i]||0)!==(vb[i]||0))return (va[i]||0)>(vb[i]||0);
  }
  return false;
}
async function requestBytes(url,timeoutMs,maxBytes) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(url,{signal:controller.signal,cache:'no-store'});
    if(!res.ok)throw new Error('HTTP '+res.status+' from '+new URL(url).pathname);
    const length=Number(res.headers.get('content-length')||0);
    if(length>maxBytes)throw new Error('Download too large: '+length);
    const parts=[];let size=0;
    for await(const chunk of res.body){
      size+=chunk.length;
      if(size>maxBytes)throw new Error('Download exceeds safety limit');
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }finally{clearTimeout(timer);}
}
async function requestWithRetries(url,timeoutMs,maxBytes,onRetry=()=>{}) {
  let error;
  for(let attempt=1;attempt<=4;attempt++){
    try{return await requestBytes(url,timeoutMs,maxBytes);}
    catch(e){
      error=e;
      if(attempt===4)break;
      onRetry(attempt,e);
      await sleep(400*attempt);
    }
  }
  throw new Error('Download failed after 4 attempts: '+url+' — '+(error?.message||error),{cause:error});
}
export async function checkForUpdate(manifestUrl,currentVersion,timeoutMs=30000){
  const basic={configured:!!manifestUrl,currentVersion:String(currentVersion),latestVersion:null,updateAvailable:false,publishedAt:null,notes:[],manifest:null,manifestUrl,error:null};
  if(!manifestUrl)return basic;
  try{
    const buffer=await requestWithRetries(manifestUrl,Math.min(30000,timeoutMs),2*1024*1024);
    const manifest=JSON.parse(buffer.toString('utf8'));
    if(!manifest || typeof manifest.version!=='string' || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.bundle?.parts) || !manifest.bundle.sha256)throw new Error('Invalid update manifest');
    return {...basic,latestVersion:manifest.version,
      updateAvailable:newer(manifest.version,currentVersion),
      publishedAt:manifest.publishedAt||null,notes:Array.isArray(manifest.notes)?manifest.notes:[],
      manifest};
  }catch(error){
    return {...basic,error:error?.message||String(error)};
  }
}
export async function stageUpdate({manifest,manifestUrl,projectRoot,timeoutMs=30000}){
  if(!manifest || !Array.isArray(manifest.files) || !Array.isArray(manifest.bundle?.parts))
    throw new Error('Update manifest is incomplete');
  if(!/^https:\/\//i.test(manifestUrl||''))throw new Error('Update manifest must be downloaded over HTTPS');
  if(manifest.bundle.encoding!=='gzip-base64')throw new Error('Unsupported update bundle encoding');
  if(manifest.bundle.parts.length<1||manifest.bundle.parts.length>250)throw new Error('Invalid update bundle part count');
  const logPath=path.join(projectRoot,'logs','update-download.log');
  fs.mkdirSync(path.dirname(logPath),{recursive:true});
  const log=(m)=>{try{fs.appendFileSync(logPath,new Date().toISOString()+' '+m+'\n');}catch{}};
  const started=Date.now();
  log('staging update v'+manifest.version+'; parts='+manifest.bundle.parts.length);
  // Never delete the active version or touch data/ until the complete archive is hash verified.
  const chunks=new Array(manifest.bundle.parts.length);
  let cursor=0,failed=null;
  const workers=Array.from({length:Math.min(3,chunks.length)},async()=>{
    while(!failed && cursor<chunks.length){
      const i=cursor++,part=manifest.bundle.parts[i];
      try{
        if(typeof part!=='string'||!/^\.\/releases\/[0-9.]+\/part-[0-9]+\.txt$/.test(part))
          throw new Error('Unexpected bundle part path');
        const url=new URL(part,manifestUrl).href;
        const result=await requestWithRetries(url,Math.min(45000,Math.max(15000,timeoutMs)),128*1024,
          (attempt,err)=>log('retry part '+(i+1)+' attempt '+attempt+': '+err.message));
        chunks[i]=result.toString('utf8').trim();
        log('received part '+(i+1)+'/'+chunks.length+' bytes='+result.length);
      }catch(error){failed=error;log('FAILED part '+(i+1)+': '+error.message);}
    }
  });
  await Promise.all(workers);
  if(failed)throw failed;
  const archive=Buffer.from(chunks.join(''),'base64');
  if(!archive.length||sha256(archive)!==manifest.bundle.sha256){
    log('FAILED: archive SHA256 mismatch');throw new Error('Update archive checksum mismatch');
  }
  let payload;
  try{payload=JSON.parse(gunzipSync(archive,{maxOutputLength:64*1024*1024}).toString('utf8'));}
  catch(e){log('FAILED: archive decode '+e.message);throw new Error('Corrupted update archive: '+e.message);}
  if(!payload || typeof payload.files!=='object')throw new Error('Update archive missing file map');

  const stageRoot=path.join(projectRoot,'data','updates','stage-'+Date.now()+'-'+process.pid);
  const stageTemp=stageRoot+'.partial';
  try{
    fs.mkdirSync(stageTemp,{recursive:true});
    for(const file of manifest.files){
      const rel=safePath(file.path);
      if(!/^[a-f0-9]{64}$/i.test(file.sha256))throw new Error('Invalid checksum for '+rel);
      const encoded=payload.files[rel];
      if(typeof encoded!=='string')throw new Error('Archive missing '+rel);
      const bytes=Buffer.from(encoded,'base64');
      if(sha256(bytes)!==file.sha256)throw new Error('File checksum mismatch: '+rel);
      const target=path.join(stageTemp,...rel.split('/'));
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.writeFileSync(target,bytes);
    }
    fs.writeFileSync(path.join(stageTemp,'staged-manifest.json'),JSON.stringify(manifest,null,2));
    fs.renameSync(stageTemp,stageRoot);
    log('staged v'+manifest.version+' successfully in '+(Date.now()-started)+'ms');
    return {version:manifest.version,stagingRoot:stageRoot};
  }catch(error){
    fs.rmSync(stageTemp,{recursive:true,force:true});
    log('FAILED verify/stage: '+error.message);
    throw error;
  }
}
