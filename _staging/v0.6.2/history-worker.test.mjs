import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { openDatabase, insertHistorySnapshot } from './src/db.mjs';

function runWorker(workerData){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./src/history-stats-worker.mjs',import.meta.url),{workerData});
    worker.once('message',resolve);
    worker.once('error',reject);
    worker.once('exit',(code)=>{ if(code!==0) reject(new Error(`worker exited ${code}`)); });
  });
}

test('history worker reads 7-day stats without using the main connection',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bz-hist-worker-'));
  const dbPath=path.join(dir,'bazaar.sqlite');
  const db=openDatabase(dbPath);
  const now=Date.now();
  try{
    insertHistorySnapshot(db,now-2*86400000,[
      {productId:'TEST_ITEM',bestBuyOrder:100,bestSellOffer:120,sellMovingWeek:1,buyMovingWeek:1,sellVolume:1,buyVolume:1,sellOrders:1,buyOrders:1}
    ],'DESKTOP',{sourceTs:now-2*86400000,collectedAt:now-2*86400000});
    insertHistorySnapshot(db,now-86400000,[
      {productId:'TEST_ITEM',bestBuyOrder:200,bestSellOffer:220,sellMovingWeek:1,buyMovingWeek:1,sellVolume:1,buyVolume:1,sellOrders:1,buyOrders:1}
    ],'DESKTOP',{sourceTs:now-86400000,collectedAt:now-86400000});
  } finally {
    db.close();
  }

  const message=await runWorker({dbPath,nowTs:now,historyIntervalSeconds:300});
  assert.equal(message.ok,true);
  const stats=new Map(message.entries);
  assert(stats.has('TEST_ITEM'));
  assert.equal(stats.get('TEST_ITEM').samples7d,2);
  assert.equal(stats.get('TEST_ITEM').avgBuy7d,150);
  assert.equal(stats.get('TEST_ITEM').avgSell7d,170);
  fs.rmSync(dir,{recursive:true,force:true});
});

test('server has no synchronous 7-day history aggregation path',()=>{
  const server=fs.readFileSync('./server.mjs','utf8');
  assert(!server.includes('loadHistoryStats('));
  assert(server.includes('refreshHistoryStatsAsync'));
  assert(server.includes("new Worker(new URL('./src/history-stats-worker.mjs'"));
  assert(server.includes("refreshHistoryStatsAsync('snapshot',false)"));
  assert(server.includes("refreshHistoryStatsAsync('startup',true)"));
  assert(server.includes('historyStatsLoading'));
});
