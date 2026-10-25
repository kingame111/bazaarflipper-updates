import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {openDatabase,insertHistorySnapshot,createVerifiedHandoffExport,
  importHandoffDatabase} from '../candidate-src/src/db.mjs';
import {receiveFile} from '../candidate-src/src/handoff.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-handoff-safety-'));
const mk=p=>path.join(dir,p);
const ts=Date.now()-240000;
const row=p=>({productId:'COBBLESTONE',bestBuyOrder:p,bestSellOffer:p+10,
  sellMovingWeek:5,buyMovingWeek:6,sellVolume:8,buyVolume:9,
  sellOrders:1,buyOrders:2});
let desk,lap;
try{
 desk=openDatabase(mk('desktop.sqlite'));
 lap=openDatabase(mk('laptop.sqlite'));
 insertHistorySnapshot(lap,ts,[row(120)],'LAPTOP');
 assert.equal(lap.prepare('SELECT COUNT(*) n FROM history').get().n,1);
 // Snapshot must include committed changes that may still be in the WAL.
 const info=createVerifiedHandoffExport(lap,mk('snapshot.sqlite'));
 assert.ok(info.bytes>0);
 assert.equal(info.rows,1);
 const source=new (await import('node:sqlite')).DatabaseSync(mk('snapshot.sqlite'),{readOnly:true});
 try{
   assert.equal(source.prepare('SELECT best_buy_order p FROM history').get().p,120);
   assert.equal(Object.values(source.prepare('PRAGMA quick_check').get())[0],'ok');
 }finally{source.close()}
 let result=importHandoffDatabase(desk,mk('snapshot.sqlite'));
 assert.equal(result.verified,true);
 assert.equal(desk.prepare('SELECT best_buy_order p FROM history').get().p,120);

 // A conflicting copy must roll back ALL attempted inserts and competition replacements.
 const conflictTime=ts+300000;
 insertHistorySnapshot(desk,conflictTime,[row(10)],'DESKTOP');
 const lapConflict=openDatabase(mk('laptop-conflict.sqlite'));
 try{
   insertHistorySnapshot(lapConflict,conflictTime,[row(999)],'LAPTOP');
   createVerifiedHandoffExport(lapConflict,mk('conflict.sqlite'));
 }finally{lapConflict.close()}
 const before=desk.prepare('SELECT COUNT(*) n FROM history').get().n;
 assert.throws(()=>importHandoffDatabase(desk,mk('conflict.sqlite')),/verification failed before commit/);
 assert.equal(desk.prepare('SELECT COUNT(*) n FROM history').get().n,before);
 assert.equal(desk.prepare('SELECT best_buy_order p FROM history WHERE ts=?',).get(conflictTime).p,10);
 assert.equal(Object.values(desk.prepare('PRAGMA integrity_check').get())[0],'ok');

 // Streaming receiver rejects oversized payloads and removes partial copies.
 const oversize=Readable.from([Buffer.alloc(7),Buffer.alloc(9)]);
 await assert.rejects(receiveFile(oversize,mk('oversize.bin'),10),/maximum allowed size/);
 assert.equal(fs.existsSync(mk('oversize.bin')),false);
 const within=Readable.from([Buffer.alloc(7),Buffer.alloc(2)]);
 assert.equal(await receiveFile(within,mk('small.bin'),10),9);
 assert.equal(fs.statSync(mk('small.bin')).size,9);
 desk.close();lap.close();desk=null;lap=null;
 console.log(JSON.stringify({PASS:true,WALComplete:true,atomicRollback:true,
   temporarySnapshotVerified:true,uploadSizeCapEnforced:true,smallStreamAccepted:true}));
}finally{
 try{desk?.close()}catch{}
 try{lap?.close()}catch{}
 fs.rmSync(dir,{recursive:true,force:true});
}
