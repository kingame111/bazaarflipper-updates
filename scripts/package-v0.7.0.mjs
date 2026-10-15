#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

const sha=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(fs.readFileSync('manifest.json','utf8'));
if(!['0.6.13','0.7.0'].includes(baseline.version)) throw Error('Wrong base version: '+baseline.version);

const raw=Buffer.from(baseline.bundle.parts.map(p=>fs.readFileSync(p,'utf8').trim()).join(''),'base64');
const baseFiles=JSON.parse(gunzipSync(raw).toString('utf8')).files;
// A release must be INSTALLABLE FROM SCRATCH, not just a patch to a
// preexisting Windows folder. Recover unchanged runtime dependencies from
// the newest preceding release that contained each source file.
const legacyFiles=new Map();
const versions=fs.readdirSync('releases',{withFileTypes:true})
  .filter(x=>x.isDirectory()&&/^\d+\.\d+\.\d+$/.test(x.name)&&x.name!=='0.7.0')
  .map(x=>x.name)
  .sort((a,b)=>{
    const x=a.split('.').map(Number),y=b.split('.').map(Number);
    for(let i=0;i<3;i++)if(x[i]!==y[i])return y[i]-x[i];
    return 0;
  });
for(const v of versions){
  const dir=path.join('releases',v);
  const chunks=fs.readdirSync(dir)
    .filter(x=>/^part-\d+\.txt$/.test(x))
    .sort();
  if(!chunks.length)continue;
  try{
    const packed=Buffer.from(chunks.map(x=>fs.readFileSync(path.join(dir,x),'utf8').trim()).join(''),'base64');
    const decoded=JSON.parse(gunzipSync(packed).toString('utf8')).files;
    for(const [p,encoded] of Object.entries(decoded||{})){
      if(typeof encoded!=='string')continue;
      if(!legacyFiles.has(p))legacyFiles.set(p,encoded);
    }
  }catch(error){
    console.warn('Historical archive v'+v+' cannot be reused:',error.message);
  }
}
const candidateFiles=['runtime-manager.mjs'];
for(const folder of ['src','public']){
  const dir=path.join('candidate-src',folder);
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.isFile() && /\.(mjs|js|css|html|svg)$/.test(entry.name))candidateFiles.push(folder+'/'+entry.name);
  }
}
const runtimeResource=p=>/^(src|public)\/.+\.(mjs|js|css|html|svg)$/.test(p);
const paths=[...new Set([
  ...Object.keys(baseFiles),
  ...[...legacyFiles.keys()].filter(runtimeResource),
  ...candidateFiles
])].sort();
if(!paths.includes('server.mjs')||!paths.includes('src/db.mjs'))throw Error('Required update files missing from base release');
for(const required of ['src/hypixel.mjs','src/scoring.mjs','src/handoff.mjs','src/state.mjs',
  'public/app.js','public/pending-sync.js','public/styles.css']){
  if(!paths.includes(required))throw Error('Missing vital standalone dependency: '+required);
}

const data={};
for(const p of paths){
  if(p.includes('..')||p.startsWith('/'))throw Error('Unsafe file path '+p);
  const local=path.join('candidate-src',p);
  let source;
  if(fs.existsSync(local))source=fs.readFileSync(local);
  else{
    const old=legacyFiles.get(p)??baseFiles[p];
    if(typeof old!=='string')throw Error('No source available for '+p);
    source=Buffer.from(old,'base64');
  }
  if(/\.(mjs|js)$/.test(p)){
    const check=spawnSync(process.execPath,['--check','--input-type=module','-'],{input:source,encoding:'utf8'});
    if(check.status!==0)throw Error('Syntax error in '+p+': '+check.stderr);
  }
  data[p]=source.toString('base64');
}
console.log('RELEASE SOURCE AUDIT: full standalone package; dependencies='+paths.length+'; archived fallback='+paths.filter(p=>!fs.existsSync(path.join('candidate-src',p))).length);
const pkg=JSON.parse(Buffer.from(data['package.json'],'base64').toString('utf8'));
if(pkg.version!=='0.7.0') throw Error('Version mismatch');

fs.rmSync('releases/0.7.0',{recursive:true,force:true});
const archive=gzipSync(Buffer.from(JSON.stringify({files:data}),'utf8'),{level:9});
const encoded=archive.toString('base64'),parts=[];
for(let i=0;i<encoded.length;i+=16000){
  const p='releases/0.7.0/part-'+String(parts.length+1).padStart(3,'0')+'.txt';
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,encoded.slice(i,i+16000));
  parts.push('./'+p);
}
const manifest={
  version:'0.7.0',
  publishedAt:new Date().toISOString(),
  notes:[
    'Independent supervisor on localhost:3212 so updates are available even while the Bazaar data server is stuck.',
    'Journaled file replacement, rollback on failed health check and recovery after interrupted file swapping.',
    'Dedicated lightweight /health/live and /health/ready probes without querying history or Hypixel.',
    'Hash-verified snapshot receipts, conflicting-origin observation audit and rejection of modified replays.',
    'Accurate distinction between synchronization triggers and confirmed transferred snapshots.',
    'Adaptive bounded backlog draining, with conservative background pauses between batches.',
    'Move minion calculation off the HTTP server event loop to bounded worker threads.',
    'Preserve previous historical-query and DB-maintenance improvements from v0.6.13.'
  ],
  files:paths.map(p=>({path:p,sha256:sha(Buffer.from(data[p],'base64'))})),
  bundle:{parts,encoding:'gzip-base64',sha256:sha(archive)}
};
fs.writeFileSync('manifest.json',JSON.stringify(manifest,null,2)+'\n');

const rebuilt=Buffer.from(parts.map(p=>fs.readFileSync(p,'utf8')).join(''),'base64');
if(sha(rebuilt)!==manifest.bundle.sha256) throw Error('Round-trip package hash');
const decoded=JSON.parse(gunzipSync(rebuilt).toString('utf8')).files;
for(const f of manifest.files){
  if(sha(Buffer.from(decoded[f.path],'base64'))!==f.sha256) throw Error('Round-trip source hash '+f.path);
}
console.log('PACKAGE PASS: '+manifest.version+' / '+paths.length+' sources / '+parts.length+' chunks / '+archive.length+' bytes');
