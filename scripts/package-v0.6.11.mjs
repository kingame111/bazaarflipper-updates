#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const sha=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(fs.readFileSync('manifest.json','utf8'));
if(baseline.version!=='0.6.10' && baseline.version!=='0.6.11')
  throw Error('Wrong base version: '+baseline.version);
const baseParts=Array.from({length:8},(_,i)=>'releases/0.6.10/part-'+String(i+1).padStart(3,'0')+'.txt');
const raw=Buffer.from(baseParts.map(p=>fs.readFileSync(p,'utf8').trim()).join(''),'base64');
const baseManifestFiles=JSON.parse(gunzipSync(raw).toString('utf8')).files;
const basePaths=Object.keys(baseManifestFiles);
if(basePaths.length!==13)throw Error('Expected 13 old release source files');
const paths=[...basePaths,'src/minion-recipes.mjs'];
const data={};
for(const p of paths){
 if(p.includes('..')||p.startsWith('/'))throw Error('Unsafe path '+p);
 const content=fs.readFileSync(path.join('candidate-src',p));
 if(/\.(mjs|js)$/.test(p)){
  const check=spawnSync(process.execPath,['--check',path.join('candidate-src',p)],{encoding:'utf8'});
  if(check.status!==0)throw Error('Syntax '+p+': '+check.stderr);
 }
 data[p]=content.toString('base64');
}
const pkg=JSON.parse(Buffer.from(data['package.json'],'base64').toString('utf8'));
if(pkg.version!=='0.6.11')throw Error('Version mismatch');
const archive=gzipSync(Buffer.from(JSON.stringify({files:data}),'utf8'),{level:9});
const encoded=archive.toString('base64'),parts=[];
for(let i=0;i<encoded.length;i+=16000){
 const p='releases/0.6.11/part-'+String(parts.length+1).padStart(3,'0')+'.txt';
 fs.mkdirSync(path.dirname(p),{recursive:true});
 fs.writeFileSync(p,encoded.slice(i,i+16000));
 parts.push('./'+p);
}
const manifest={
 version:'0.6.11',
 publishedAt:new Date().toISOString(),
 notes:[
  'Initial minion overhaul: independently Bazaar-price each verified Ghast tier ingredient including Silver Fang; add the tier XII NPC fee.',
  'Introduce an extensible per-tier recipe resolver and fail closed for incomplete or unverified recipes.',
  'Fix Diamond Spreading roll counts per resource item instead of per collection cycle.',
  'Fix PAYBACK ranking that could prefer N/A over valid setup investment.',
  'Support dynamic tier counts, NET/PAYBACK/HORIZON optimization and separate incremental upgrade payback.',
  'Improve storage uncertainty warnings and missing-value rendering. Minion algorithm remains under extended audit.'
 ],
 files:paths.map(p=>({path:p,sha256:sha(Buffer.from(data[p],'base64'))})),
 bundle:{parts,encoding:'gzip-base64',sha256:sha(archive)}
};
fs.writeFileSync('manifest.json',JSON.stringify(manifest,null,2)+'\n');
const rebuilt=Buffer.from(parts.map(p=>fs.readFileSync(p,'utf8')).join(''),'base64');
if(sha(rebuilt)!==manifest.bundle.sha256)throw Error('Round-trip package hash');
const decoded=JSON.parse(gunzipSync(rebuilt).toString('utf8')).files;
for(const f of manifest.files)if(sha(Buffer.from(decoded[f.path],'base64'))!==f.sha256)
  throw Error('Round-trip source hash '+f.path);
console.log('PACKAGE PASS: '+manifest.version+' / '+paths.length+' sources / '+parts.length+' chunks / '+archive.length+' bytes');
