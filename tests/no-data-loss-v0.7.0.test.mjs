import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDatabase,insertHistorySnapshot,pendingHistoryStats,
  exportPendingHistorySnapshots,acknowledgeHistorySnapshots} from '../candidate-src/src/db.mjs';

// Fail the build if a future cleanup path starts evicting UNSENT data again.
const source=fs.readFileSync('candidate-src/server.mjs','utf8');
const start=source.indexOf('function enforceLaptopStoragePolicy(){');
const end=source.indexOf('\nloadLastGoodMarketCache();',start);
assert.ok(start>=0&&end>start);
const policy=source.slice(start,end);
assert.doesNotMatch(policy,/dropOldestPendingSnapshots\s*\(/,
  'Storage pressure may not evict unsynced snapshots');
assert.match(policy,/return false;/);
assert.match(source,/else if \(!enforceLaptopStoragePolicy\(\)\)/,
  'Block NEW writes before SQLite insert if laptop disk is critically low');
assert.match(policy,/syncLaptopToDesktop\(false\)/,
  'Free-space pressure should prioritize a verified transfer');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-queue-retention-'));
try{
  const db=openDatabase(path.join(tmp,'laptop.sqlite'));
  const now=Date.now();
  for(let i=0;i<80;i++)insertHistorySnapshot(db,now-i*300000,
    [{productId:'COBBLESTONE',bestBuyOrder:100+i,bestSellOffer:120+i}],'LAPTOP');
  const before=pendingHistoryStats(db,'LAPTOP');
  assert.equal(before.snapshots,80);
  assert.equal(exportPendingHistorySnapshots(db,'LAPTOP',100).length,80);
  assert.equal(pendingHistoryStats(db,'LAPTOP').snapshots,80,
    'Exporting an unacknowledged batch MUST NOT delete it');
  const firstBatch=exportPendingHistorySnapshots(db,'LAPTOP',15);
  const result=acknowledgeHistorySnapshots(db,firstBatch,'LAPTOP');
  assert.equal(result.snapshotsDeleted,15);
  assert.equal(pendingHistoryStats(db,'LAPTOP').snapshots,65);
  assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0],'ok');
  db.close();
  console.log(JSON.stringify({PASS:true,unsyncedQueuePreserved:true,
    noDiskEviction:true,acknowledgeOnlyDeletesConfirmedRows:true,queued:80}));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
