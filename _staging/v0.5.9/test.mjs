import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  openDatabase, insertHistorySnapshot, exportPendingHistorySnapshots,
  importHistorySnapshots, acknowledgeHistorySnapshots, pendingHistoryStats,
  cleanupHistory, saveCompetitionStats, loadCompetitionStats, loadHistoryStats,
  checkpointDatabase, importHandoffDatabase
} from './src/db.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bz-v059-'));
const sourcePath=path.join(tmp,'source.sqlite');
const targetPath=path.join(tmp,'target.sqlite');

function columns(db,table){return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r=>r.name));}
function count(db,table){return Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);}


const legacyPath=path.join(tmp,'legacy-v058.sqlite');
{
  const legacy=new DatabaseSync(legacyPath);
  legacy.exec(`
    CREATE TABLE history (
      ts INTEGER NOT NULL, product_id TEXT NOT NULL,
      best_buy_order REAL NOT NULL, best_sell_offer REAL NOT NULL,
      sell_moving_week REAL NOT NULL, buy_moving_week REAL NOT NULL,
      sell_volume REAL NOT NULL, buy_volume REAL NOT NULL,
      sell_orders INTEGER NOT NULL, buy_orders INTEGER NOT NULL,
      PRIMARY KEY (ts, product_id)
    );
    CREATE TABLE history_snapshots (
      ts INTEGER PRIMARY KEY, origin_id TEXT NOT NULL, received_at INTEGER NOT NULL
    );
    CREATE TABLE competition_stats (
      product_id TEXT PRIMARY KEY, observed_ms REAL NOT NULL,
      entry_better_events REAL NOT NULL, exit_better_events REAL NOT NULL,
      margin_samples INTEGER NOT NULL, margin_mean REAL NOT NULL,
      margin_m2 REAL NOT NULL, updated_ts INTEGER NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  legacy.prepare('INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?)').run(1000,'LEGACY',1,2,3,4,5,6,7,8);
  legacy.prepare('INSERT INTO history_snapshots VALUES (?,?,?)').run(1000,'DESKTOP',1500);
  legacy.close();
}
{
  const migrated=openDatabase(legacyPath);
  try {
    const cols=columns(migrated,'history');
    for(const c of ['weighted_buy_price','weighted_sell_price','best_buy_amount','best_sell_amount','buy_depth_1pct','sell_depth_1pct','buy_depth_5pct','sell_depth_5pct']) assert(cols.has(c),`migration missing ${c}`);
    const legacyRow=migrated.prepare('SELECT * FROM history WHERE product_id=?').get('LEGACY');
    assert.equal(legacyRow.best_buy_order,1);
    assert.equal(legacyRow.weighted_buy_price,0);
    const migratedMeta=migrated.prepare('SELECT * FROM history_snapshot_meta WHERE bucket_ts=? AND origin_id=?').get(1000,'DESKTOP');
    assert(migratedMeta);
    assert.equal(migratedMeta.schema_version,1);
    assert.equal(migratedMeta.source_ts,1000);
  } finally { migrated.close(); }
}

const source=openDatabase(sourcePath);
try {
  const h=columns(source,'history');
  for(const c of ['weighted_buy_price','weighted_sell_price','best_buy_amount','best_sell_amount','buy_depth_1pct','sell_depth_1pct','buy_depth_5pct','sell_depth_5pct']) assert(h.has(c),`missing history column ${c}`);
  for(const t of ['history_snapshot_meta','history_hourly','history_daily','competition_daily']) assert.doesNotThrow(()=>source.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());

  const sourceTs=Date.UTC(2026,8,21,22,17,43);
  const bucketTs=Math.floor(sourceTs/300000)*300000;
  const collectedAt=sourceTs+1234;
  const rows=[
    {productId:'A',bestBuyOrder:100,bestSellOffer:110,sellMovingWeek:1000,buyMovingWeek:900,sellVolume:500,buyVolume:450,sellOrders:20,buyOrders:19,weightedBuyPrice:101,weightedSellPrice:109,bestBuyAmount:25,bestSellAmount:30,buyDepth1Pct:100,sellDepth1Pct:120,buyDepth5Pct:400,sellDepth5Pct:420},
    {productId:'B',bestBuyOrder:200,bestSellOffer:225,sellMovingWeek:2000,buyMovingWeek:1900,sellVolume:800,buyVolume:750,sellOrders:30,buyOrders:29,weightedBuyPrice:202,weightedSellPrice:222,bestBuyAmount:35,bestSellAmount:40,buyDepth1Pct:140,sellDepth1Pct:160,buyDepth5Pct:500,sellDepth5Pct:520}
  ];
  insertHistorySnapshot(source,bucketTs,rows,'LAPTOP',{sourceTs,collectedAt,productCount:rows.length,effectiveTaxRate:0.0125,schemaVersion:2});
  assert.equal(count(source,'history'),2);
  const meta=source.prepare('SELECT * FROM history_snapshot_meta WHERE bucket_ts=? AND origin_id=?').get(bucketTs,'LAPTOP');
  assert.equal(meta.source_ts,sourceTs);
  assert.equal(meta.collected_at,collectedAt);
  assert.equal(meta.product_count,2);
  assert.equal(meta.effective_tax_rate,0.0125);

  // Duplicate local insert must not duplicate historical product rows.
  insertHistorySnapshot(source,bucketTs,rows,'LAPTOP',{sourceTs,collectedAt,productCount:2,effectiveTaxRate:0.0125,schemaVersion:2});
  assert.equal(count(source,'history'),2);

  const pending=exportPendingHistorySnapshots(source,'LAPTOP',12);
  assert.equal(pending.length,1);
  assert.equal(pending[0].rows.length,2);
  assert.equal(pending[0].meta.sourceTs,sourceTs);
  assert.equal(pending[0].rows[0].buyDepth5Pct,400);

  const target=openDatabase(targetPath);
  try {
    let result=importHistorySnapshots(target,pending,'LAPTOP');
    assert.equal(result.rowsInserted,2);
    assert.equal(count(target,'history'),2);
    let tmeta=target.prepare('SELECT * FROM history_snapshot_meta WHERE bucket_ts=? AND origin_id=?').get(bucketTs,'LAPTOP');
    assert.equal(tmeta.source_ts,sourceTs);
    assert.equal(tmeta.collected_at,collectedAt);
    assert(tmeta.ingested_at>=collectedAt);

    // Re-import is idempotent.
    result=importHistorySnapshots(target,pending,'LAPTOP');
    assert.equal(result.rowsInserted,0);
    assert.equal(count(target,'history'),2);

    // Same 5-minute bucket from desktop must not duplicate market rows.
    insertHistorySnapshot(target,bucketTs,rows,'DESKTOP',{sourceTs:sourceTs+2000,collectedAt:sourceTs+2500,productCount:2,effectiveTaxRate:0.0125,schemaVersion:2});
    assert.equal(count(target,'history'),2);
    assert.equal(count(target,'history_snapshot_meta'),2);

    // Competition daily snapshot remains available after current accumulator changes.
    const dyn=new Map([['A',{observedMs:60000,entryBetterEvents:2,exitBetterEvents:3,marginSamples:4,marginMean:5,marginM2:6,updatedTs:sourceTs}]]);
    saveCompetitionStats(target,dyn,sourceTs);
    assert.equal(count(target,'competition_stats'),1);
    assert.equal(count(target,'competition_daily'),1);
    assert.equal(loadCompetitionStats(target).get('A').marginMean,5);

    // 7d stats still use raw rows correctly.
    const stats=loadHistoryStats(target,bucketTs+1000,300).get('A');
    assert(stats);
    assert.equal(stats.avgBuy7d,100);
    assert.equal(stats.avgSell7d,110);

    // Rollup: old raw rows -> hourly, without losing averages/min/max/depth.
    const oldBase=Date.UTC(2026,6,1,12,0,0);
    const r1={...rows[0],bestBuyOrder:90,bestSellOffer:100,weightedBuyPrice:91,weightedSellPrice:99,buyDepth1Pct:80,sellDepth1Pct:90};
    const r2={...rows[0],bestBuyOrder:110,bestSellOffer:120,weightedBuyPrice:111,weightedSellPrice:119,buyDepth1Pct:120,sellDepth1Pct:130};
    insertHistorySnapshot(target,oldBase,[r1],'DESKTOP',{sourceTs:oldBase+1000,collectedAt:oldBase+1100,productCount:1,effectiveTaxRate:0.01,schemaVersion:2});
    insertHistorySnapshot(target,oldBase+300000,[r2],'DESKTOP',{sourceTs:oldBase+301000,collectedAt:oldBase+301100,productCount:1,effectiveTaxRate:0.01,schemaVersion:2});
    const rolled=cleanupHistory(target,oldBase+3600000,oldBase-86400000);
    assert(rolled.rawRowsDeleted>=2);
    const hourly=target.prepare('SELECT * FROM history_hourly WHERE product_id=? AND bucket_ts=?').get('A',oldBase);
    assert(hourly);
    assert.equal(hourly.samples,2);
    assert.equal(hourly.avg_best_buy_order,100);
    assert.equal(hourly.min_mid,95);
    assert.equal(hourly.max_mid,115);
    assert.equal(hourly.avg_buy_depth_1pct,100);

    // Hourly -> permanent daily archive.
    const dailyCutoff=oldBase+2*86400000;
    cleanupHistory(target,dailyCutoff,dailyCutoff);
    const daily=target.prepare('SELECT * FROM history_daily WHERE product_id=?').get('A');
    assert(daily);
    assert(daily.samples>=2);


    // Full DB handoff preserves v0.5.9-only fields and metadata.
    checkpointDatabase(source);
    const handoffPath=path.join(tmp,'handoff-target.sqlite');
    const handoffTarget=openDatabase(handoffPath);
    try {
      const full=importHandoffDatabase(handoffTarget,sourcePath);
      assert.equal(full.verified,true);
      const copied=handoffTarget.prepare('SELECT * FROM history WHERE ts=? AND product_id=?').get(bucketTs,'A');
      assert(copied);
      assert.equal(copied.weighted_buy_price,101);
      assert.equal(copied.buy_depth_5pct,400);
      const copiedMeta=handoffTarget.prepare('SELECT * FROM history_snapshot_meta WHERE bucket_ts=? AND origin_id=?').get(bucketTs,'LAPTOP');
      assert(copiedMeta);
      assert.equal(copiedMeta.source_ts,sourceTs);
      assert.equal(copiedMeta.collected_at,collectedAt);
    } finally { handoffTarget.close(); }

    // Acknowledgement removes source pending snapshot and metadata together.
    const before=pendingHistoryStats(source,'LAPTOP');
    assert.equal(before.snapshots,1);
    const ack=acknowledgeHistorySnapshots(source,pending,'LAPTOP');
    assert.equal(ack.snapshotsDeleted,1);
    assert.equal(pendingHistoryStats(source,'LAPTOP').snapshots,0);
    assert.equal(source.prepare('SELECT COUNT(*) n FROM history_snapshot_meta WHERE bucket_ts=? AND origin_id=?').get(bucketTs,'LAPTOP').n,0);

    checkpointDatabase(target);
  } finally { target.close(); }
} finally {
  source.close();
  fs.rmSync(tmp,{recursive:true,force:true});
}
console.log('v0.5.9 database tests: PASS');
