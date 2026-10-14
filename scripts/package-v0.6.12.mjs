#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

const sha=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(fs.readFileSync('manifest.json','utf8'));
if(baseline.version!=='0.6.11') throw Error('Wrong base version: '+baseline.version);

const raw=Buffer.from(baseline.bundle.parts.map(p=>fs.readFileSync(p,'utf8').trim()).join(''),'base64');
const baseFiles=JSON.parse(gunzipSync(raw).toString('utf8')).files;
const paths=Object.keys(baseFiles);
if(!paths.includes('server.mjs')||!paths.includes('src/db.mjs')) throw Error('Required update files missing from base release');

const data={};
for(const p of paths){
  if(p.includes('..')||p.startsWith('/')) throw Error('Unsafe path '+p);
  const file=path.join('candidate-src',p);
  const content=fs.readFileSync(file);
  if(/\.(mjs|js)$/.test(p)){
    const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(check.status!==0) throw Error('Syntax '+p+': '+check.stderr);
  }
  data[p]=content.toString('base64');
}
const pkg=JSON.parse(Buffer.from(data['package.json'],'base64').toString('utf8'));
if(pkg.version!=='0.6.12') throw Error('Version mismatch');

const archive=gzipSync(Buffer.from(JSON.stringify({files:data}),'utf8'),{level:9});
const encoded=archive.toString('base64'),parts=[];
for(let i=0;i<encoded.length;i+=16000){
  const p='releases/0.6.12/part-'+String(parts.length+1).padStart(3,'0')+'.txt';
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,encoded.slice(i,i+16000));
  parts.push('./'+p);
}
const manifest={
  version:'0.6.12',
  publishedAt:new Date().toISOString(),
  notes:[
    'Decouple startup from Hypixel requests so the UI and dual-sync scheduler become available immediately after local database initialization.',
    'Start dual synchronization independently in the background instead of waiting for Bazaar, item metadata or mayor-tax requests.',
    'Bound automatic backlog sync to small batches and yield between batches so hundreds of pending snapshots cannot freeze the local web server.',
    'Remove routine VACUUM from successful sync acknowledgements; keep acknowledgement transactional without blocking the Node process for compaction.',
    'Use metadata-backed pending row counts and short-lived status caches to keep /api/status fast on large databases.',
    'Persist and restore the last known good Bazaar snapshot so restarts during a Hypixel outage open in LAST_GOOD_SNAPSHOT instead of an empty STARTING state.'
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
