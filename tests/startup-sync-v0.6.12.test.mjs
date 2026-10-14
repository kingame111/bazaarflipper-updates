import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,ensureExtendedHistorySchema,insertHistorySnapshot,pendingHistoryStats,historyRowEstimate} from '../candidate-src/src/db.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-sync-test-'));
const dbPath=path.join(tmp,'test.sqlite');
const db=openDatabase(dbPath,{deferExtendedHistory:true});
ensureExtendedHistorySchema(db);

try{
  const productRows=Array.from({length:25},(_,i)=>({
    productId:'P'+i,
    bestBuyOrder:100+i,
    bestSellOffer:110+i,
    sellMovingWeek:1000,
    buyMovingWeek:1000,
    sellVolume:100,
    buyVolume:100,
    sellOrders:10,
    buyOrders:10
  }));
  const start=Date.now()-700*300000;
  for(let i=0;i<700;i++) insertHistorySnapshot(db,start+i*300000,productRows,'LAPTOP',{productCount:productRows.length});
  const pending=pendingHistoryStats(db,'LAPTOP');
  assert.equal(pending.snapshots,700);
  assert.equal(pending.rows,700*25);
  assert.equal(historyRowEstimate(db),700*25);

  const server=fs.readFileSync('candidate-src/server.mjs','utf8');
  assert.ok(server.includes("keepTimer(setTimeout(runAutoSync,250))"),'sync should arm before external startup work completes');
  assert.ok(server.includes("void refreshItems().finally(()=>{void pollBazaar();});"),'Hypixel fetch must be background-only at startup');
  assert.ok(!server.includes("if(acknowledgedSnapshots) compactDatabase(db)"),'routine sync must not VACUUM');
  assert.ok(server.includes("const maxBatches=manual?500:2"),'automatic sync must be bounded');
  assert.ok(server.includes("Math.min(4,Number(config.syncBatchSnapshots)||4)"),'sync batches must stay responsive');
  assert.ok(server.includes("loadLastGoodMarketCache();"),'startup must restore last good market cache');
  assert.ok(server.includes("LAST_GOOD_SNAPSHOT"),'cached/stale data mode must remain supported');
  console.log(JSON.stringify({status:'PASS',snapshots:pending.snapshots,rows:pending.rows}));
} finally {
  db.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}
