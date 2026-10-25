import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,insertHistorySnapshot,importHistorySnapshots,resetCollectedData,
  ensureExtendedHistorySchema,exportPendingHistorySnapshots,acknowledgeHistorySnapshots} from '../candidate-src/src/db.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-sync-integrity-'));
try{
 const desktop=openDatabase(path.join(dir,'desktop.sqlite'));
 const laptop=openDatabase(path.join(dir,'laptop.sqlite'));
 const ts=Date.now()-300000;
 const buy=(price)=>({productId:'DIAMOND',bestBuyOrder:price,bestSellOffer:price+10,
   sellMovingWeek:100,buyMovingWeek:100,sellVolume:50,buyVolume:55,sellOrders:3,buyOrders:4});
 insertHistorySnapshot(desktop,ts,[buy(100)],'DESKTOP');
 insertHistorySnapshot(laptop,ts,[buy(101)],'LAPTOP');
 const snaps=exportPendingHistorySnapshots(laptop,'LAPTOP');
 assert.equal(snaps.length,1);
 const first=importHistorySnapshots(desktop,snaps,'LAPTOP');
 assert.equal(first.acceptedSnapshots,1);
 assert.equal(first.conflictingObservations,1);
 assert.equal(first.rowsInserted,0);
 assert.equal(desktop.prepare('SELECT best_buy_order p FROM history WHERE ts=? AND product_id=?').get(ts,'DIAMOND').p,100);
 assert.equal(desktop.prepare('SELECT COUNT(*) n FROM history_observation_conflicts').get().n,1);
 const conflict=desktop.prepare('SELECT incoming_json s FROM history_observation_conflicts').get();
 assert.equal(JSON.parse(conflict.s).bestBuyOrder,101);
 const second=importHistorySnapshots(desktop,snaps,'LAPTOP');
 assert.equal(second.duplicateSnapshots,1);
 assert.equal(second.verifiedSnapshots,1);
 assert.equal(second.conflictingObservations,0);
 // A retransmit with the same timestamp but different data must not be acknowledged.
 const changed=structuredClone(snaps);
 changed[0].rows[0].bestBuyOrder=999;
 assert.throws(()=>importHistorySnapshots(desktop,changed,'LAPTOP'),/Snapshot content conflict/);
 const future=ts+600000;
 assert.throws(()=>importHistorySnapshots(desktop,[{ts:future,originId:'LAPTOP',meta:{productCount:2200},rows:[]}],'LAPTOP'),/Empty snapshot/);
 assert.throws(()=>importHistorySnapshots(desktop,[{ts:future,originId:'LAPTOP',meta:{productCount:1},rows:[{productId:null}]}],'LAPTOP'),/Invalid or repeated/);
 assert.throws(()=>importHistorySnapshots(desktop,[{ts:future,originId:'LAPTOP',meta:{productCount:1},rows:[{productId:'IRON',bestBuyOrder:-5}]}],'LAPTOP'),/Invalid snapshot/);
 assert.throws(()=>importHistorySnapshots(desktop,[{ts:future,originId:'LAPTOP',meta:{productCount:2},rows:[{productId:'IRON',bestBuyOrder:1}]}],'LAPTOP'),/count mismatch/);
 assert.equal(desktop.prepare('SELECT COUNT(*) n FROM sync_imported_snapshots').get().n,1);
 const ack=acknowledgeHistorySnapshots(laptop,snaps,'LAPTOP');
 assert.equal(ack.snapshotsDeleted,1);
 assert.equal(exportPendingHistorySnapshots(laptop,'LAPTOP').length,0);
 // Test migrations of a legacy DB with no content hash column.
 const legacy=openDatabase(path.join(dir,'legacy.sqlite'),{deferExtendedHistory:true});
 const before=legacy.prepare('PRAGMA table_info(sync_imported_snapshots)').all();
 assert.equal(before.some(x=>x.name==='content_hash'),false);
 ensureExtendedHistorySchema(legacy);
 const after=legacy.prepare('PRAGMA table_info(sync_imported_snapshots)').all();
 assert.equal(after.some(x=>x.name==='content_hash'),true);
 resetCollectedData(desktop);
 assert.equal(desktop.prepare('SELECT COUNT(*) n FROM sync_imported_snapshots').get().n,0);
 legacy.close();desktop.close();laptop.close();
 console.log(JSON.stringify({pass:true,differentOriginPreserved:true,duplicateIdempotent:true,
   alteredReplayRejected:true,acknowledgementSafe:true,legacyMigrated:true}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
