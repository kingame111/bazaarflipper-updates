import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {gzipSync} from 'node:zlib';
import {openDatabase,insertHistorySnapshot,loadHistoryStats,ensureExtendedHistorySchema} from '../candidate-src/src/db.mjs';
import {checkForUpdate,stageUpdate} from '../candidate-src/src/updater.mjs';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-reliability-'));
try{
  const pathDb=path.join(tmp,'history.sqlite');
  const db=openDatabase(pathDb,{deferExtendedHistory:true});
  ensureExtendedHistorySchema(db);
  const now=Date.now();
  const rows=Array.from({length:2200},(_,i)=>({
    productId:'PRODUCT_'+String(i).padStart(4,'0'),
    bestBuyOrder:100+i*0.1,bestSellOffer:105+i*0.1,
    sellMovingWeek:1000+i,buyMovingWeek:1100+i,
    sellVolume:300,buyVolume:250,sellOrders:7,buyOrders:8,
    weightedBuyPrice:100+i*0.1,weightedSellPrice:105+i*0.1,
    bestBuyAmount:60,bestSellAmount:55,buyDepth1Pct:300,buyDepth5Pct:400,
    sellDepth1Pct:290,sellDepth5Pct:410
  }));
  const started=performance.now();
  // 700 real-sized 2,200-product snapshots = 1.54m SQLite rows.
  for(let i=0;i<700;i++){
    const ts=now-(700-i)*300000;
    insertHistorySnapshot(db,ts,rows,'DESKTOP',{productCount:rows.length});
  }
  const insertMs=Math.round(performance.now()-started);
  const total=db.prepare('SELECT COUNT(*) n FROM history').get().n;
  assert.equal(total,1540000);
  const statsStart=performance.now();
  const stats=loadHistoryStats(db,now,300);
  const statsMs=Math.round(performance.now()-statsStart);
  assert.equal(stats.size,2200);
  const known=stats.get('PRODUCT_0000');
  assert.equal(known.samples7d,700);
  assert.equal(known.samples1d,288); // 24 hours with a snapshot every 5 minutes
  assert.ok(Math.abs(known.avgBuy7d-100)<1e-6);
  assert.ok(Math.abs(known.avgSell7d-105)<1e-6);
  assert.ok(known.coverage7d>0 && known.coverage7d<0.4);
  assert.ok(known.ref1hTs>0 && known.ref24hTs>0);
  assert.ok(statsMs<120000,'7-day aggregation took '+statsMs+'ms on CI; investigate query plan');
  db.close();

  const singleDb=openDatabase(path.join(tmp,'small.sqlite'));
  const sampleTs=[now-8*86400000,now-6*86400000,now-5*86400000,now-3*86400000,now-86400000,now-600000,now-300000];
  sampleTs.forEach((ts,i)=>insertHistorySnapshot(singleDb,ts,[{productId:'VARIABLE',bestBuyOrder:i+10,bestSellOffer:i+20}]));
  const obj=loadHistoryStats(singleDb,now).get('VARIABLE');
  for(let days=1;days<=7;days++){
    const cutoff=now-days*86400000;
    const expected=singleDb.prepare('SELECT COUNT(*) n,AVG(best_buy_order) b,AVG(best_sell_offer) s FROM history WHERE ts>=? AND product_id=?').get(cutoff,'VARIABLE');
    assert.equal(obj['samples'+days+'d'],expected.n);
    assert.ok(Math.abs(obj['avgBuy'+days+'d']-expected.b)<1e-8);
    assert.ok(Math.abs(obj['avgSell'+days+'d']-expected.s)<1e-8);
  }
  singleDb.close();

  const active=path.join(tmp,'active');
  fs.mkdirSync(path.join(active,'logs'),{recursive:true});
  fs.mkdirSync(path.join(active,'data'),{recursive:true});
  fs.writeFileSync(path.join(active,'server.mjs'),'original');
  fs.writeFileSync(path.join(active,'data','bazaar.sqlite'),'DO-NOT-TOUCH');
  const files={'server.mjs':Buffer.from('replacement')};
  const archive=gzipSync(Buffer.from(JSON.stringify({files:Object.fromEntries(Object.entries(files).map(([k,b])=>[k,b.toString('base64')]))})));
  const enc=archive.toString('base64');
  const manifest={
    version:'0.6.13',publishedAt:new Date().toISOString(),notes:[],
    files:[{path:'server.mjs',sha256:sha(files['server.mjs'])}],
    bundle:{encoding:'gzip-base64',sha256:sha(archive),parts:['./releases/0.6.13/part-001.txt','./releases/0.6.13/part-002.txt']}
  };
  const manifestUrl='https://raw.githubusercontent.com/example/repo/main/manifest.json';
  const fetchOld=globalThis.fetch;
  let failures=0;
  globalThis.fetch=async url=>{
    const u=String(url);
    if(u.endsWith('manifest.json'))return new Response(JSON.stringify(manifest),{status:200});
    if(u.endsWith('part-001.txt')&&failures++===0)throw new Error('temporary network dropout');
    if(u.endsWith('part-001.txt'))return new Response(enc.slice(0,Math.floor(enc.length/2)),{status:200});
    if(u.endsWith('part-002.txt'))return new Response(enc.slice(Math.floor(enc.length/2)),{status:200});
    throw Error('Unexpected URL '+u);
  };
  try{
    const checked=await checkForUpdate(manifestUrl,'0.6.10');
    assert.equal(checked.updateAvailable,true);
    const staged=await stageUpdate({manifest,manifestUrl,projectRoot:active,timeoutMs:15000});
    assert.equal(fs.readFileSync(path.join(staged.stagingRoot,'server.mjs'),'utf8'),'replacement');
    assert.equal(fs.readFileSync(path.join(active,'server.mjs'),'utf8'),'original');
    assert.equal(fs.readFileSync(path.join(active,'data','bazaar.sqlite'),'utf8'),'DO-NOT-TOUCH');
    assert.ok(failures>=2,'network retry was not exercised');
    assert.match(fs.readFileSync(path.join(active,'logs','update-download.log'),'utf8'),/retry part/);
    const tampered={...manifest,bundle:{...manifest.bundle,sha256:'0'.repeat(64)}};
    await assert.rejects(stageUpdate({manifest:tampered,manifestUrl,projectRoot:active,timeoutMs:15000}),/checksum mismatch/);
  }finally{globalThis.fetch=fetchOld;}
  console.log(JSON.stringify({PASS:true,snapshots:700,productsPerSnapshot:2200,rows:total,insertMs,statsMs,
    updateRetriesTested:true,rollbackDataUntouched:true}));
}finally{fs.rmSync(tmp,{force:true,recursive:true});}
