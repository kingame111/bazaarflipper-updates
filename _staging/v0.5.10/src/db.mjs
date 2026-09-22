import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(filePath, options = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA temp_store = MEMORY;');
  db.exec('PRAGMA busy_timeout = 5000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      ts INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      best_buy_order REAL NOT NULL,
      best_sell_offer REAL NOT NULL,
      sell_moving_week REAL NOT NULL,
      buy_moving_week REAL NOT NULL,
      sell_volume REAL NOT NULL,
      buy_volume REAL NOT NULL,
      sell_orders INTEGER NOT NULL,
      buy_orders INTEGER NOT NULL,
      PRIMARY KEY (ts, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_history_product_ts
      ON history(product_id, ts DESC);

    CREATE TABLE IF NOT EXISTS history_snapshots (
      ts INTEGER PRIMARY KEY,
      origin_id TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_snapshots_origin_ts
      ON history_snapshots(origin_id, ts ASC);

    CREATE TABLE IF NOT EXISTS competition_stats (
      product_id TEXT PRIMARY KEY,
      observed_ms REAL NOT NULL,
      entry_better_events REAL NOT NULL,
      exit_better_events REAL NOT NULL,
      margin_samples INTEGER NOT NULL,
      margin_mean REAL NOT NULL,
      margin_m2 REAL NOT NULL,
      updated_ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);


  if (!options.deferExtendedHistory) ensureExtendedHistorySchema(db);
  return db;
}

export function ensureExtendedHistorySchema(db) {
  const existingHistoryColumns = new Set(db.prepare('PRAGMA table_info(history)').all().map((row) => String(row.name)));
  const historyColumns = [
    ['weighted_buy_price', 'REAL NOT NULL DEFAULT 0'], ['weighted_sell_price', 'REAL NOT NULL DEFAULT 0'],
    ['best_buy_amount', 'REAL NOT NULL DEFAULT 0'], ['best_sell_amount', 'REAL NOT NULL DEFAULT 0'],
    ['buy_depth_1pct', 'REAL NOT NULL DEFAULT 0'], ['sell_depth_1pct', 'REAL NOT NULL DEFAULT 0'],
    ['buy_depth_5pct', 'REAL NOT NULL DEFAULT 0'], ['sell_depth_5pct', 'REAL NOT NULL DEFAULT 0']
  ];
  for (const [name, definition] of historyColumns) if (!existingHistoryColumns.has(name)) db.exec(`ALTER TABLE history ADD COLUMN ${name} ${definition};`);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_snapshot_meta (
      bucket_ts INTEGER NOT NULL, origin_id TEXT NOT NULL, source_ts INTEGER NOT NULL,
      collected_at INTEGER NOT NULL, ingested_at INTEGER NOT NULL, product_count INTEGER NOT NULL DEFAULT 0,
      effective_tax_rate REAL NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 2,
      PRIMARY KEY (bucket_ts, origin_id)
    );
    CREATE INDEX IF NOT EXISTS idx_history_snapshot_meta_source ON history_snapshot_meta(source_ts DESC);
    CREATE TABLE IF NOT EXISTS history_hourly (
      bucket_ts INTEGER NOT NULL, product_id TEXT NOT NULL, samples INTEGER NOT NULL,
      valid_best_buy_samples INTEGER NOT NULL, valid_best_sell_samples INTEGER NOT NULL,
      valid_weighted_buy_samples INTEGER NOT NULL, valid_weighted_sell_samples INTEGER NOT NULL,
      avg_best_buy_order REAL NOT NULL, avg_best_sell_offer REAL NOT NULL,
      avg_weighted_buy_price REAL NOT NULL, avg_weighted_sell_price REAL NOT NULL,
      min_mid REAL NOT NULL, max_mid REAL NOT NULL, avg_sell_moving_week REAL NOT NULL, avg_buy_moving_week REAL NOT NULL,
      avg_sell_volume REAL NOT NULL, avg_buy_volume REAL NOT NULL, avg_sell_orders REAL NOT NULL, avg_buy_orders REAL NOT NULL,
      avg_best_buy_amount REAL NOT NULL, avg_best_sell_amount REAL NOT NULL, avg_buy_depth_1pct REAL NOT NULL, avg_sell_depth_1pct REAL NOT NULL,
      avg_buy_depth_5pct REAL NOT NULL, avg_sell_depth_5pct REAL NOT NULL, PRIMARY KEY (bucket_ts, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_history_hourly_product_ts ON history_hourly(product_id, bucket_ts DESC);
    CREATE TABLE IF NOT EXISTS history_daily (
      bucket_ts INTEGER NOT NULL, product_id TEXT NOT NULL, samples INTEGER NOT NULL,
      valid_best_buy_samples INTEGER NOT NULL, valid_best_sell_samples INTEGER NOT NULL,
      valid_weighted_buy_samples INTEGER NOT NULL, valid_weighted_sell_samples INTEGER NOT NULL,
      avg_best_buy_order REAL NOT NULL, avg_best_sell_offer REAL NOT NULL,
      avg_weighted_buy_price REAL NOT NULL, avg_weighted_sell_price REAL NOT NULL,
      min_mid REAL NOT NULL, max_mid REAL NOT NULL, avg_sell_moving_week REAL NOT NULL, avg_buy_moving_week REAL NOT NULL,
      avg_sell_volume REAL NOT NULL, avg_buy_volume REAL NOT NULL, avg_sell_orders REAL NOT NULL, avg_buy_orders REAL NOT NULL,
      avg_best_buy_amount REAL NOT NULL, avg_best_sell_amount REAL NOT NULL, avg_buy_depth_1pct REAL NOT NULL, avg_sell_depth_1pct REAL NOT NULL,
      avg_buy_depth_5pct REAL NOT NULL, avg_sell_depth_5pct REAL NOT NULL, PRIMARY KEY (bucket_ts, product_id)
    );
    CREATE INDEX IF NOT EXISTS idx_history_daily_product_ts ON history_daily(product_id, bucket_ts DESC);
    CREATE TABLE IF NOT EXISTS competition_daily (
      day_ts INTEGER NOT NULL, product_id TEXT NOT NULL, observed_ms REAL NOT NULL, entry_better_events REAL NOT NULL,
      exit_better_events REAL NOT NULL, margin_samples INTEGER NOT NULL, margin_mean REAL NOT NULL, margin_m2 REAL NOT NULL,
      updated_ts INTEGER NOT NULL, PRIMARY KEY (day_ts, product_id)
    );
    INSERT OR IGNORE INTO history_snapshot_meta (bucket_ts, origin_id, source_ts, collected_at, ingested_at, product_count, effective_tax_rate, schema_version)
      SELECT ts, origin_id, ts, received_at, received_at, 0, 0, 1 FROM history_snapshots;
  `);
  


export function insertHistorySnapshot(db,timestamp,rows,originId='LOCAL',meta={}){
 const insert=db.prepare(`INSERT OR IGNORE INTO history (ts,product_id,best_buy_order,best_sell_offer,sell_moving_week,buy_moving_week,sell_volume,buy_volume,sell_orders,buy_orders,weighted_buy_price,weighted_sell_price,best_buy_amount,best_sell_amount,buy_depth_1pct,sell_depth_1pct,buy_depth_5pct,sell_depth_5pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const list=Array.isArray(rows)?rows:[],sourceTs=Number(meta.sourceTs)||Number(timestamp),collectedAt=Number(meta.collectedAt)||Date.now(),productCount=Math.max(0,Number(meta.productCount)||list.length),tax=Math.max(0,Number(meta.effectiveTaxRate)||0),schema=Math.max(1,Number(meta.schemaVersion)||2);
 db.exec('BEGIN IMMEDIATE;');try{for(const r of list){if(!r?.productId)continue;insert.run(timestamp,String(r.productId),Number(r.bestBuyOrder)||0,Number(r.bestSellOffer)||0,Number(r.sellMovingWeek)||0,Number(r.buyMovingWeek)||0,Number(r.sellVolume)||0,Number(r.buyVolume)||0,Number(r.sellOrders)||0,Number(r.buyOrders)||0,Number(r.weightedBuyPrice)||0,Number(r.weightedSellPrice)||0,Number(r.bestBuyAmount)||0,Number(r.bestSellAmount)||0,Number(r.buyDepth1Pct)||0,Number(r.sellDepth1Pct)||0,Number(r.buyDepth5Pct)||0,Number(r.sellDepth5Pct)||0);}
 db.prepare('INSERT OR IGNORE INTO history_snapshots (ts,origin_id,received_at) VALUES (?,?,?)').run(timestamp,String(originId||'LOCAL'),Date.now());
 db.prepare(`INSERT INTO history_snapshot_meta (bucket_ts,origin_id,source_ts,collected_at,ingested_at,product_count,effective_tax_rate,schema_version) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(bucket_ts,origin_id) DO UPDATE SET source_ts=excluded.source_ts,collected_at=excluded.collected_at,ingested_at=excluded.ingested_at,product_count=excluded.product_count,effective_tax_rate=excluded.effective_tax_rate,schema_version=excluded.schema_version`).run(timestamp,String(originId||'LOCAL'),sourceTs,collectedAt,Date.now(),productCount,tax,schema);
 db.exec('COMMIT;');}catch(e){db.exec('ROLLBACK;');throw e;}
}

export function cleanupHistory(db,rawCutoffTs,hourlyCutoffTs=null){
 const HOUR=3600000,DAY=86400000,safeRaw=Math.floor(Number(rawCutoffTs)/HOUR)*HOUR,safeHourly=Number.isFinite(Number(hourlyCutoffTs))?Math.floor(Number(hourlyCutoffTs)/DAY)*DAY:null;let rawRowsDeleted=0,hourlyRowsDeleted=0;
 db.exec('BEGIN IMMEDIATE;');try{
 db.prepare(`INSERT OR REPLACE INTO history_hourly (bucket_ts,product_id,samples,valid_best_buy_samples,valid_best_sell_samples,valid_weighted_buy_samples,valid_weighted_sell_samples,avg_best_buy_order,avg_best_sell_offer,avg_weighted_buy_price,avg_weighted_sell_price,min_mid,max_mid,avg_sell_moving_week,avg_buy_moving_week,avg_sell_volume,avg_buy_volume,avg_sell_orders,avg_buy_orders,avg_best_buy_amount,avg_best_sell_amount,avg_buy_depth_1pct,avg_sell_depth_1pct,avg_buy_depth_5pct,avg_sell_depth_5pct)
 SELECT CAST(ts/? AS INTEGER)*?,product_id,COUNT(*),SUM(CASE WHEN best_buy_order>0 THEN 1 ELSE 0 END),SUM(CASE WHEN best_sell_offer>0 THEN 1 ELSE 0 END),SUM(CASE WHEN weighted_buy_price>0 THEN 1 ELSE 0 END),SUM(CASE WHEN weighted_sell_price>0 THEN 1 ELSE 0 END),
 COALESCE(AVG(CASE WHEN best_buy_order>0 THEN best_buy_order END),0),COALESCE(AVG(CASE WHEN best_sell_offer>0 THEN best_sell_offer END),0),COALESCE(AVG(CASE WHEN weighted_buy_price>0 THEN weighted_buy_price END),0),COALESCE(AVG(CASE WHEN weighted_sell_price>0 THEN weighted_sell_price END),0),
 COALESCE(MIN(CASE WHEN best_buy_order>0 AND best_sell_offer>0 THEN (best_buy_order+best_sell_offer)/2.0 END),0),COALESCE(MAX(CASE WHEN best_buy_order>0 AND best_sell_offer>0 THEN (best_buy_order+best_sell_offer)/2.0 END),0),
 AVG(sell_moving_week),AVG(buy_moving_week),AVG(sell_volume),AVG(buy_volume),AVG(sell_orders),AVG(buy_orders),AVG(best_buy_amount),AVG(best_sell_amount),AVG(buy_depth_1pct),AVG(sell_depth_1pct),AVG(buy_depth_5pct),AVG(sell_depth_5pct)
 FROM history WHERE ts<? GROUP BY CAST(ts/? AS INTEGER),product_id`).run(HOUR,HOUR,safeRaw,HOUR);
 rawRowsDeleted=Number(db.prepare('DELETE FROM history WHERE ts < ?').run(safeRaw).changes)||0;db.prepare('DELETE FROM history_snapshots WHERE ts < ?').run(safeRaw);
 if(safeHourly!=null){db.prepare(`INSERT OR REPLACE INTO history_daily (bucket_ts,product_id,samples,valid_best_buy_samples,valid_best_sell_samples,valid_weighted_buy_samples,valid_weighted_sell_samples,avg_best_buy_order,avg_best_sell_offer,avg_weighted_buy_price,avg_weighted_sell_price,min_mid,max_mid,avg_sell_moving_week,avg_buy_moving_week,avg_sell_volume,avg_buy_volume,avg_sell_orders,avg_buy_orders,avg_best_buy_amount,avg_best_sell_amount,avg_buy_depth_1pct,avg_sell_depth_1pct,avg_buy_depth_5pct,avg_sell_depth_5pct)
 SELECT CAST(bucket_ts/? AS INTEGER)*?,product_id,SUM(samples),SUM(valid_best_buy_samples),SUM(valid_best_sell_samples),SUM(valid_weighted_buy_samples),SUM(valid_weighted_sell_samples),
 COALESCE(SUM(avg_best_buy_order*valid_best_buy_samples)/NULLIF(SUM(valid_best_buy_samples),0),0),COALESCE(SUM(avg_best_sell_offer*valid_best_sell_samples)/NULLIF(SUM(valid_best_sell_samples),0),0),COALESCE(SUM(avg_weighted_buy_price*valid_weighted_buy_samples)/NULLIF(SUM(valid_weighted_buy_samples),0),0),COALESCE(SUM(avg_weighted_sell_price*valid_weighted_sell_samples)/NULLIF(SUM(valid_weighted_sell_samples),0),0),
 COALESCE(MIN(NULLIF(min_mid,0)),0),COALESCE(MAX(max_mid),0),COALESCE(SUM(avg_sell_moving_week*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_buy_moving_week*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_sell_volume*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_buy_volume*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_sell_orders*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_buy_orders*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_best_buy_amount*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_best_sell_amount*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_buy_depth_1pct*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_sell_depth_1pct*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_buy_depth_5pct*samples)/NULLIF(SUM(samples),0),0),COALESCE(SUM(avg_sell_depth_5pct*samples)/NULLIF(SUM(samples),0),0)
 FROM history_hourly WHERE bucket_ts<? GROUP BY CAST(bucket_ts/? AS INTEGER),product_id`).run(DAY,DAY,safeHourly,DAY);hourlyRowsDeleted=Number(db.prepare('DELETE FROM history_hourly WHERE bucket_ts < ?').run(safeHourly).changes)||0;}
 db.exec('COMMIT;');return{rawRowsDeleted,hourlyRowsDeleted,rawCutoffTs:safeRaw,hourlyCutoffTs:safeHourly};}catch(e){db.exec('ROLLBACK;');throw e;}
}

export function exportPendingHistorySnapshots(db,originId='LAPTOP',limit=4){
 const stamps=db.prepare('SELECT ts FROM history_snapshots WHERE origin_id=? ORDER BY ts ASC LIMIT ?').all(originId,Math.max(1,Number(limit)||4));
 const rows=db.prepare(`SELECT product_id productId,best_buy_order bestBuyOrder,best_sell_offer bestSellOffer,sell_moving_week sellMovingWeek,buy_moving_week buyMovingWeek,sell_volume sellVolume,buy_volume buyVolume,sell_orders sellOrders,buy_orders buyOrders,weighted_buy_price weightedBuyPrice,weighted_sell_price weightedSellPrice,best_buy_amount bestBuyAmount,best_sell_amount bestSellAmount,buy_depth_1pct buyDepth1Pct,sell_depth_1pct sellDepth1Pct,buy_depth_5pct buyDepth5Pct,sell_depth_5pct sellDepth5Pct FROM history WHERE ts=? ORDER BY product_id ASC`);
 const meta=db.prepare(`SELECT source_ts sourceTs,collected_at collectedAt,product_count productCount,effective_tax_rate effectiveTaxRate,schema_version schemaVersion FROM history_snapshot_meta WHERE bucket_ts=? AND origin_id=?`);
 return stamps.map(({ts})=>({ts:Number(ts),originId:String(originId),meta:meta.get(ts,originId)||null,rows:rows.all(ts)}));
}

export function importHistorySnapshots(db,snapshots=[],originId='LAPTOP'){
 const ins=db.prepare(`INSERT OR IGNORE INTO history (ts,product_id,best_buy_order,best_sell_offer,sell_moving_week,buy_moving_week,sell_volume,buy_volume,sell_orders,buy_orders,weighted_buy_price,weighted_sell_price,best_buy_amount,best_sell_amount,buy_depth_1pct,sell_depth_1pct,buy_depth_5pct,sell_depth_5pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const marker=db.prepare('INSERT OR IGNORE INTO history_snapshots (ts,origin_id,received_at) VALUES (?,?,?)'),meta=db.prepare(`INSERT INTO history_snapshot_meta (bucket_ts,origin_id,source_ts,collected_at,ingested_at,product_count,effective_tax_rate,schema_version) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(bucket_ts,origin_id) DO UPDATE SET source_ts=excluded.source_ts,collected_at=excluded.collected_at,ingested_at=excluded.ingested_at,product_count=excluded.product_count,effective_tax_rate=excluded.effective_tax_rate,schema_version=excluded.schema_version`);
 let rowsInserted=0,snapshotsRecorded=0;db.exec('BEGIN IMMEDIATE;');try{for(const snap of Array.isArray(snapshots)?snapshots:[]){const ts=Number(snap?.ts);if(!Number.isFinite(ts))continue;const sourceOrigin=String(snap?.originId||originId||'LAPTOP'),list=Array.isArray(snap?.rows)?snap.rows:[];for(const x of list){const r=Array.isArray(x)?{productId:x[0],bestBuyOrder:x[1],bestSellOffer:x[2],sellMovingWeek:x[3],buyMovingWeek:x[4],sellVolume:x[5],buyVolume:x[6],sellOrders:x[7],buyOrders:x[8]}:x;if(!r?.productId)continue;const y=ins.run(ts,String(r.productId),Number(r.bestBuyOrder)||0,Number(r.bestSellOffer)||0,Number(r.sellMovingWeek)||0,Number(r.buyMovingWeek)||0,Number(r.sellVolume)||0,Number(r.buyVolume)||0,Number(r.sellOrders)||0,Number(r.buyOrders)||0,Number(r.weightedBuyPrice)||0,Number(r.weightedSellPrice)||0,Number(r.bestBuyAmount)||0,Number(r.bestSellAmount)||0,Number(r.buyDepth1Pct)||0,Number(r.sellDepth1Pct)||0,Number(r.buyDepth5Pct)||0,Number(r.sellDepth5Pct)||0);rowsInserted+=Number(y.changes)||0;}snapshotsRecorded+=Number(marker.run(ts,sourceOrigin,Date.now()).changes)||0;const m=snap?.meta||{};meta.run(ts,sourceOrigin,Number(m.sourceTs)||ts,Number(m.collectedAt)||ts,Date.now(),Math.max(0,Number(m.productCount)||list.length),Math.max(0,Number(m.effectiveTaxRate)||0),Math.max(1,Number(m.schemaVersion)||1));}db.exec('COMMIT;');}catch(e){db.exec('ROLLBACK;');throw e;}return{rowsInserted,snapshotsRecorded};
}

export function acknowledgeHistorySnapshots(db, snapshots = [], originId = 'LAPTOP') {
  const has=db.prepare('SELECT 1 AS yes FROM history_snapshots WHERE ts = ? AND origin_id = ?');
  const delRows=db.prepare('DELETE FROM history WHERE ts = ?');
  const delMark=db.prepare('DELETE FROM history_snapshots WHERE ts = ? AND origin_id = ?');
  const delMeta=db.prepare('DELETE FROM history_snapshot_meta WHERE bucket_ts = ? AND origin_id = ?');
  let snapshotsDeleted=0, rowsDeleted=0;
  db.exec('BEGIN IMMEDIATE;');
  try { for(const snap of snapshots){ const ts=Number(snap?.ts); if(!has.get(ts,originId)) continue; rowsDeleted += Number(delRows.run(ts).changes)||0; snapshotsDeleted += Number(delMark.run(ts,originId).changes)||0; delMeta.run(ts,originId); } db.exec('COMMIT;'); } catch(e){db.exec('ROLLBACK;'); throw e;}
  return {snapshotsDeleted,rowsDeleted};
}

export function pendingHistoryStats(db, originId='LAPTOP') {
  const s=db.prepare('SELECT COUNT(*) n, MIN(ts) oldestTs, MAX(ts) newestTs FROM history_snapshots WHERE origin_id=?').get(originId);
  const r=db.prepare('SELECT COUNT(*) n FROM history WHERE ts IN (SELECT ts FROM history_snapshots WHERE origin_id=?)').get(originId);
  return {snapshots:Number(s?.n)||0, rows:Number(r?.n)||0, oldestTs:s?.oldestTs?Number(s.oldestTs):null, newestTs:s?.newestTs?Number(s.newestTs):null};
}

export function dropOldestPendingSnapshots(db, originId='LAPTOP', count=1) {
  const stamps=db.prepare('SELECT ts FROM history_snapshots WHERE origin_id=? ORDER BY ts ASC LIMIT ?').all(originId,Math.max(1,Number(count)||1));
  return acknowledgeHistorySnapshots(db, stamps, originId);
}

export function compactDatabase(db){ try{db.exec('PRAGMA wal_checkpoint(TRUNCATE);');}catch{} try{db.exec('VACUUM;');}catch{} }


export function getHistory(db, productId, sinceTs, limit = 1000) {
  return db.prepare(`
    SELECT ts, best_buy_order AS bestBuyOrder, best_sell_offer AS bestSellOffer,
           sell_moving_week AS sellMovingWeek, buy_moving_week AS buyMovingWeek,
           sell_volume AS sellVolume, buy_volume AS buyVolume,
           sell_orders AS sellOrders, buy_orders AS buyOrders
    FROM history
    WHERE product_id = ? AND ts >= ?
    ORDER BY ts ASC
    LIMIT ?
  `).all(productId, sinceTs, limit);
}

export function loadCompetitionStats(db) {
  const rows = db.prepare(`
    SELECT product_id AS productId,
           observed_ms AS observedMs,
           entry_better_events AS entryBetterEvents,
           exit_better_events AS exitBetterEvents,
           margin_samples AS marginSamples,
           margin_mean AS marginMean,
           margin_m2 AS marginM2,
           updated_ts AS updatedTs
    FROM competition_stats
  `).all();

  return new Map(rows.map((row) => [row.productId, row]));
}

export function saveCompetitionStats(db,map,timestamp=Date.now()){
 const upsert=db.prepare(`INSERT INTO competition_stats (product_id,observed_ms,entry_better_events,exit_better_events,margin_samples,margin_mean,margin_m2,updated_ts) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET observed_ms=excluded.observed_ms,entry_better_events=excluded.entry_better_events,exit_better_events=excluded.exit_better_events,margin_samples=excluded.margin_samples,margin_mean=excluded.margin_mean,margin_m2=excluded.margin_m2,updated_ts=excluded.updated_ts`),daily=db.prepare(`INSERT INTO competition_daily (day_ts,product_id,observed_ms,entry_better_events,exit_better_events,margin_samples,margin_mean,margin_m2,updated_ts) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(day_ts,product_id) DO UPDATE SET observed_ms=excluded.observed_ms,entry_better_events=excluded.entry_better_events,exit_better_events=excluded.exit_better_events,margin_samples=excluded.margin_samples,margin_mean=excluded.margin_mean,margin_m2=excluded.margin_m2,updated_ts=excluded.updated_ts`);
 const day=Math.floor(Number(timestamp)/86400000)*86400000;db.exec('BEGIN IMMEDIATE;');try{for(const[id,s]of map){const v=[Number(s.observedMs)||0,Number(s.entryBetterEvents)||0,Number(s.exitBetterEvents)||0,Number(s.marginSamples)||0,Number(s.marginMean)||0,Number(s.marginM2)||0,Number(s.updatedTs)||Date.now()];upsert.run(id,...v);daily.run(day,id,...v);}db.exec('COMMIT;');}catch(e){db.exec('ROLLBACK;');throw e;}
}

export function replaceCompetitionStats(db, map) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec('DELETE FROM competition_stats;');
    const upsert = db.prepare(`
      INSERT INTO competition_stats (
        product_id, observed_ms, entry_better_events, exit_better_events,
        margin_samples, margin_mean, margin_m2, updated_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [productId, stats] of map) {
      upsert.run(
        productId,
        Number(stats.observedMs) || 0,
        Number(stats.entryBetterEvents) || 0,
        Number(stats.exitBetterEvents) || 0,
        Number(stats.marginSamples) || 0,
        Number(stats.marginMean) || 0,
        Number(stats.marginM2) || 0,
        Number(stats.updatedTs) || Date.now()
      );
    }
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}


export function loadHistoryStats(db, nowTs = Date.now(), historyIntervalSeconds = 300) {
  const dayMs = 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * dayMs;
  const sinceTs = nowTs - sevenDaysMs;
  const expectedSamples = Math.max(1, Math.round(sevenDaysMs / (Math.max(30, Number(historyIntervalSeconds) || 300) * 1000)));

  const rows = db.prepare(`
    SELECT product_id AS productId,
           COUNT(*) AS samples,
           MIN(ts) AS firstTs,
           MAX(ts) AS lastTs,
           AVG(best_buy_order) AS avgBuy7d,
           AVG(best_sell_offer) AS avgSell7d,
           AVG((best_buy_order + best_sell_offer) / 2.0) AS avgMid7d,
           AVG(((best_buy_order + best_sell_offer) / 2.0) * ((best_buy_order + best_sell_offer) / 2.0)) AS avgMidSq7d,
           MIN((best_buy_order + best_sell_offer) / 2.0) AS minMid7d,
           MAX((best_buy_order + best_sell_offer) / 2.0) AS maxMid7d
    FROM history
    WHERE ts >= ?
    GROUP BY product_id
  `).all(sinceTs);

  const nearestBefore = (targetTs, searchWindowMs) => {
    const minTs = targetTs - searchWindowMs;
    const result = db.prepare(`
      SELECT h.product_id AS productId,
             (h.best_buy_order + h.best_sell_offer) / 2.0 AS mid,
             h.ts AS ts
      FROM history h
      JOIN (
        SELECT product_id, MAX(ts) AS ts
        FROM history
        WHERE ts <= ? AND ts >= ?
        GROUP BY product_id
      ) r ON r.product_id = h.product_id AND r.ts = h.ts
    `).all(targetTs, minTs);
    return new Map(result.map((row) => [row.productId, { mid: Number(row.mid) || 0, ts: Number(row.ts) || 0 }]));
  };

  const oneHour = nearestBefore(nowTs - 60 * 60 * 1000, 2 * 60 * 60 * 1000);
  const oneDay = nearestBefore(nowTs - dayMs, 8 * 60 * 60 * 1000);

  const map = new Map();
  for (const row of rows) {
    const samples = Number(row.samples) || 0;
    const avgMid = Number(row.avgMid7d) || 0;
    const avgSq = Number(row.avgMidSq7d) || 0;
    const variance = Math.max(0, avgSq - avgMid * avgMid);
    const std = Math.sqrt(variance);
    const firstTs = Number(row.firstTs) || nowTs;
    const lastTs = Number(row.lastTs) || firstTs;
    const spanCoverage = Math.max(0, Math.min(1, (lastTs - firstTs + 1) / sevenDaysMs));
    const sampleCoverage = Math.max(0, Math.min(1, samples / expectedSamples));
    map.set(row.productId, {
      samples7d: samples,
      firstTs7d: firstTs,
      lastTs7d: lastTs,
      coverage7d: Math.min(spanCoverage, sampleCoverage),
      avgBuy7d: Number(row.avgBuy7d) || 0,
      avgSell7d: Number(row.avgSell7d) || 0,
      avgMid7d: avgMid,
      stdMid7d: std,
      cvMid7d: avgMid > 0 ? std / avgMid : 0,
      minMid7d: Number(row.minMid7d) || 0,
      maxMid7d: Number(row.maxMid7d) || 0,
      ref1hMid: oneHour.get(row.productId)?.mid || 0,
      ref1hTs: oneHour.get(row.productId)?.ts || 0,
      ref24hMid: oneDay.get(row.productId)?.mid || 0,
      ref24hTs: oneDay.get(row.productId)?.ts || 0
    });
  }
  return map;
}

export function historyCount(db) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM history').get()?.n || 0);
}

export function competitionCount(db) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM competition_stats').get()?.n || 0);
}

export function checkpointDatabase(db) {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch {}
}

export function resetCollectedData(db) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec('DELETE FROM history;');
    db.exec('DELETE FROM history_snapshots;');
    db.exec('DELETE FROM history_snapshot_meta;');
    db.exec('DELETE FROM history_hourly;');
    db.exec('DELETE FROM history_daily;');
    db.exec('DELETE FROM competition_daily;');
    db.exec('DELETE FROM competition_stats;');
    db.exec('DELETE FROM meta;');
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
  checkpointDatabase(db);
  try { db.exec('VACUUM;'); } catch {}
  checkpointDatabase(db);
}

export function importHandoffDatabase(db, sourcePath) {
  checkpointDatabase(db);
  const escaped = sourcePath.replace(/'/g, "''");
  db.exec(`ATTACH DATABASE '${escaped}' AS incoming;`);
  try {
    const hasIncomingTable = (name) => Boolean(
      db.prepare("SELECT 1 AS yes FROM incoming.sqlite_master WHERE type='table' AND name=?").get(name)?.yes
    );
    const incomingColumns = (name) => new Set(
      hasIncomingTable(name) ? db.prepare(`PRAGMA incoming.table_info(${name})`).all().map((row) => String(row.name)) : []
    );

    const sourceRows = Number(db.prepare('SELECT COUNT(*) AS n FROM incoming.history').get()?.n || 0);
    const sourceStats = Number(db.prepare('SELECT COUNT(*) AS n FROM incoming.competition_stats').get()?.n || 0);
    const hcols = incomingColumns('history');
    const historyColumns = [
      'ts','product_id','best_buy_order','best_sell_offer','sell_moving_week','buy_moving_week',
      'sell_volume','buy_volume','sell_orders','buy_orders',
      'weighted_buy_price','weighted_sell_price','best_buy_amount','best_sell_amount',
      'buy_depth_1pct','sell_depth_1pct','buy_depth_5pct','sell_depth_5pct'
    ];
    const legacyHistoryColumns = new Set([
      'ts','product_id','best_buy_order','best_sell_offer','sell_moving_week','buy_moving_week',
      'sell_volume','buy_volume','sell_orders','buy_orders'
    ]);
    const incomingHistorySelect = historyColumns.map((name) =>
      hcols.has(name) ? name : (legacyHistoryColumns.has(name) ? name : `0 AS ${name}`)
    ).join(', ');

    const copyRollupTable = (table) => {
      if (!hasIncomingTable(table)) return 0;
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name));
      const sourceCols = incomingColumns(table);
      if (!cols.every((name) => sourceCols.has(name))) return 0;
      db.exec(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) SELECT ${cols.join(',')} FROM incoming.${table};`);
      return Number(db.prepare(`SELECT COUNT(*) AS n FROM incoming.${table}`).get()?.n || 0);
    };

    let importedHourly = 0, importedDaily = 0, importedCompetitionDaily = 0, importedMeta = 0;

    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(`
        INSERT OR IGNORE INTO history (${historyColumns.join(',')})
        SELECT ${incomingHistorySelect}
        FROM incoming.history;
      `);

      if (hasIncomingTable('history_snapshots')) {
        db.exec(`
          INSERT OR IGNORE INTO history_snapshots (ts, origin_id, received_at)
          SELECT ts, origin_id, received_at FROM incoming.history_snapshots;
        `);
      }

      if (hasIncomingTable('history_snapshot_meta')) {
        db.exec(`
          INSERT OR REPLACE INTO history_snapshot_meta (
            bucket_ts, origin_id, source_ts, collected_at, ingested_at,
            product_count, effective_tax_rate, schema_version
          )
          SELECT bucket_ts, origin_id, source_ts, collected_at, ingested_at,
                 product_count, effective_tax_rate, schema_version
          FROM incoming.history_snapshot_meta;
        `);
        importedMeta = Number(db.prepare('SELECT COUNT(*) AS n FROM incoming.history_snapshot_meta').get()?.n || 0);
      }

      importedHourly = copyRollupTable('history_hourly');
      importedDaily = copyRollupTable('history_daily');
      importedCompetitionDaily = copyRollupTable('competition_daily');

      db.exec('DELETE FROM competition_stats;');
      db.exec(`
        INSERT INTO competition_stats (
          product_id, observed_ms, entry_better_events, exit_better_events,
          margin_samples, margin_mean, margin_m2, updated_ts
        )
        SELECT product_id, observed_ms, entry_better_events, exit_better_events,
               margin_samples, margin_mean, margin_m2, updated_ts
        FROM incoming.competition_stats;
      `);
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }

    const missingRows = Number(db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT ${incomingHistorySelect} FROM incoming.history
        EXCEPT
        SELECT ${historyColumns.join(',')} FROM history
      )
    `).get()?.n || 0);

    const missingMeta = hasIncomingTable('history_snapshot_meta')
      ? Number(db.prepare(`
          SELECT COUNT(*) AS n FROM (
            SELECT bucket_ts, origin_id, source_ts, collected_at, ingested_at, product_count, effective_tax_rate, schema_version
            FROM incoming.history_snapshot_meta
            EXCEPT
            SELECT bucket_ts, origin_id, source_ts, collected_at, ingested_at, product_count, effective_tax_rate, schema_version
            FROM history_snapshot_meta
          )
        `).get()?.n || 0)
      : 0;

    const statsAfter = competitionCount(db);
    return {
      sourceHistoryRows: sourceRows,
      sourceCompetitionRows: sourceStats,
      missingHistoryRows: missingRows,
      missingMetadataRows: missingMeta,
      importedMetadataRows: importedMeta,
      importedHourlyRows: importedHourly,
      importedDailyRows: importedDaily,
      importedCompetitionDailyRows: importedCompetitionDaily,
      competitionRowsAfter: statsAfter,
      verified: missingRows === 0 && missingMeta === 0 && statsAfter === sourceStats
    };
  } finally {
    try { db.exec('DETACH DATABASE incoming;'); } catch {}
    checkpointDatabase(db);
  }
}

export function setMeta(db, key, value) {
  db.prepare(`
    INSERT INTO meta(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
