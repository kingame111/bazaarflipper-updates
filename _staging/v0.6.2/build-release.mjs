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
const releaseDir=path.join(repoRoot,'releases','0.6.2');
fs.rmSync(releaseDir,{recursive:true,force:true});
fs.mkdirSync(releaseDir,{recursive:true});
const partPaths=[];
for(let i=0;i<parts.length;i++){
  const name=`part-${String(i+1).padStart(3,'0')}.txt`;
  fs.writeFileSync(path.join(releaseDir,name),parts[i],'utf8');
  partPaths.push(`./releases/0.6.2/${name}`);
}
const manifest={
  version:'0.6.2',
  publishedAt:'2026-09-22T09:30:00+03:00',
  notes:[
    'Updates the Minion Calculator catalog from 59 to 61 current minion families by adding Lily Pad Minion and Sunflower Minion.',
    'Lily Pad Minion includes all 12 current action speeds, recursive Enchanted/Condensed Lily Pad compaction, and exact setup recipes through T11; T12 setup cost remains unavailable instead of being guessed.',
    'Sunflower Minion includes all 12 action speeds, Sunflower/Moonflower recursive compaction, and a normal-operation 50/50 long-run day/night production model; Dayswitch/Nightswitch remain explicitly unmodeled.',
    'Removes the low-information Confidence sort and badges from the Minion Calculator UI; 7-day coverage and price CV remain available in the detail view.',
    'Clarifies that setup cost is one-time and never deducted from daily net profit; only recurring consumable fuel is counted as a daily expense.',
    'Carries the v0.6.1 background history-worker freeze fix and safer updater.'
  ],
  files:manifestFiles,
  bundle:{parts:partPaths,encoding:'gzip-base64',sha256:sha(gz)}
};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(JSON.stringify({parts:parts.length,bundleSha256:manifest.bundle.sha256},null,2));
