import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const root=process.cwd();
const files=[
  'server.mjs',
  'package.json',
  'config.example.json',
  'src/db.mjs',
  'src/apply-update.mjs',
  'src/history-stats-worker.mjs',
  'src/minions.mjs',
  'src/minion-data.mjs',
  'public/index.html',
  'public/minions.html',
  'public/minions.js',
  'public/minions.css'
];
const sha=(buf)=>crypto.createHash('sha256').update(buf).digest('hex');
const payload={files:{}};
const manifestFiles=[];
for(const rel of files){
  const buf=fs.readFileSync(path.join(root,rel));
  payload.files[rel]=buf.toString('base64');
  manifestFiles.push({path:rel,sha256:sha(buf)});
}
const gz=zlib.gzipSync(Buffer.from(JSON.stringify(payload),'utf8'),{level:9});
const encoded=gz.toString('base64');
const parts=[];
for(let i=0;i<encoded.length;i+=8000) parts.push(encoded.slice(i,i+8000));
const repoRoot=path.resolve(root,'../..');
const releaseDir=path.join(repoRoot,'releases','0.6.1');
fs.rmSync(releaseDir,{recursive:true,force:true});
fs.mkdirSync(releaseDir,{recursive:true});
const partPaths=[];
for(let i=0;i<parts.length;i++){
  const name=`part-${String(i+1).padStart(3,'0')}.txt`;
  fs.writeFileSync(path.join(releaseDir,name),parts[i],'utf8');
  partPaths.push(`./releases/0.6.1/${name}`);
}
const manifest={
  version:'0.6.1',
  publishedAt:'2026-09-22T09:05:00+03:00',
  notes:[
    'Fixes the v0.6.0 UI freeze caused by synchronous 7-day history aggregation on the main Node thread.',
    'Moves all 7-day history-stat calculations to a dedicated Worker so Bazaar LIVE, the UI and API remain responsive while historical calculations run.',
    'Removes synchronous history aggregation after snapshots, laptop sync imports and full database imports; background refresh is throttled to every 30 minutes unless a forced refresh is required.',
    'Exposes background-history loading/error state through status APIs.',
    'Includes the full Minion Calculator feature set from v0.6.0 and the safer v0.5.10 updater.'
  ],
  files:manifestFiles,
  bundle:{parts:partPaths,encoding:'gzip-base64',sha256:sha(gz)}
};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(JSON.stringify({parts:parts.length,bundleSha256:manifest.bundle.sha256},null,2));
