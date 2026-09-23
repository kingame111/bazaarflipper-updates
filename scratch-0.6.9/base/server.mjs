import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import util from 'node:util';
import { fileURLToPath } from 'node:url';
import { fetchBazaar, fetchItemMetadata, fetchBazaarTaxContext } from './src/hypixel.mjs';
import { analyseProduct, analyseReverseNpc, withTax, updateDynamics } from './src/scoring.mjs';
import { checkForUpdate, stageUpdate } from './src/updater.mjs';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import {
  openDatabase,
  ensureExtendedHistorySchema,
  insertHistorySnapshot,
  cleanupHistory,
  getHistory,
  loadCompetitionStats,
  saveCompetitionStats,
  replaceCompetitionStats,
  historyCount,
  checkpointDatabase,
  resetCollectedData,
  importHandoffDatabase,
  exportPendingHistorySnapshots,
  importHistorySnapshots,
  acknowledgeHistorySnapshots,
  pendingHistoryStats,
  dropOldestPendingSnapshots,
  compactDatabase,
  getMeta,
  setMeta
} from './src/db.mjs';
import {
  resolveProjectRoot,
  loadHandoffConfig,
  loadCollectorState,
  saveCollectorState,
  isAuthorized,
  readJsonBody,
  receiveFile
} from './src/handoff.mjs';
import { state } from './src/state.mjs';
import { calculateMinionRankings } from './src/minions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GITHUB_UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/kingame111/bazaarflipper-updates/main/manifest.json';
const configPath = path.join(__dirname, 'config.json');
const defaultConfigPath = path.join(__dirname, 'config.example.json');
const defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'));
const userConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
if (typeof userConfig.updateManifestUrl === 'string' && /skyflip-xi\.vercel\.app\/bazaarflipper\/manifest\.json/i.test(userConfig.updateManifestUrl)) {
  userConfig.updateManifestUrl = GITHUB_UPDATE_MANIFEST_URL;
  try { fs.writeFileSync(configPath, `${JSON.stringify(userConfig, null, 2)}\n`, 'utf8'); } catch {}
}
const config = { ...defaultConfig, ...userConfig };
const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const APP_VERSION = String(packageInfo.version || '0.0.0');
const UPDATE_MANIFEST_URL = config.updateManifestUrl || GITHUB_UPDATE_MANIFEST_URL;
const publicDir = path.join(__dirname, 'public');
const projectRoot = resolveProjectRoot(__dirname, config);
const dataDir = path.join(projectRoot, 'data');
const logsDir = path.join(projectRoot, 'logs');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });
const bootLogPath=path.join(logsDir,'boot.log');
function bootLog(message){try{fs.appendFileSync(bootLogPath,`${new Date().toISOString()} ${message}\n`,'utf8');}catch{}}
bootLog(`[boot] BazaarFlipper v${APP_VERSION} startup begin pid=${process.pid}`);
const instanceLockPath=path.join(dataDir,'server-instance.lock');
function pidAlive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function releaseInstanceLock(){try{if(fs.readFileSync(instanceLockPath,'utf8').trim()===String(process.pid))fs.rmSync(instanceLockPath,{force:true});}catch{}}
function acquireInstanceLock(){for(let attempt=0;attempt<2;attempt++){try{const fd=fs.openSync(instanceLockPath,'wx');fs.writeFileSync(fd,String(process.pid),'utf8');fs.closeSync(fd);return;}catch(error){if(error?.code!=='EEXIST')throw error;let oldPid=0;try{oldPid=Number(fs.readFileSync(instanceLockPath,'utf8').trim())||0;}catch{}if(oldPid&&pidAlive(oldPid))throw new Error(`BazaarFlipper is already running as PID ${oldPid}`);try{fs.rmSync(instanceLockPath,{force:true});}catch{}}}throw new Error('Could not acquire BazaarFlipper instance lock.');}
bootLog('[boot] acquiring single-instance lock');
acquireInstanceLock();
process.on('exit',releaseInstanceLock);
bootLog('[boot] single-instance lock acquired');

bootLog('[boot] loading handoff configuration');
const handoff = loadHandoffConfig(projectRoot, __dirname, config);
bootLog(`[boot] handoff loaded role=${handoff.role}`);
const collectorState = loadCollectorState(projectRoot, handoff.role);
const dualCollectorEnabled = ['DESKTOP','LAPTOP'].includes(handoff.role) && Boolean(handoff.peerHost) && Boolean(handoff.token);
let collectorActive = dualCollectorEnabled ? true : collectorState.active;
if (dualCollectorEnabled && !collectorState.active) saveCollectorState(collectorState.filePath, true);
const localOriginId = handoff.role === 'LAPTOP' ? 'LAPTOP' : 'DESKTOP';

const dbPath = path.join(dataDir, 'bazaar.sqlite');
bootLog('[boot] opening/migrating SQLite database');
const dbOpenStarted=Date.now();
const db = openDatabase(dbPath,{deferExtendedHistory:true});
bootLog(`[boot] core SQLite ready in ${Date.now()-dbOpenStarted}ms; extended migration deferred`);
if (handoff.role === 'LAPTOP') {
  try { db.exec('PRAGMA temp_store = FILE;'); } catch {}
}
const effectiveMinimumFreeRamMB = handoff.role === 'LAPTOP' ? 256 : Math.max(256, Number(config.minimumFreeRamMB) || 1536);
bootLog('[boot] loading competition stats');
let dynamics = loadCompetitionStats(db);
bootLog(`[boot] competition stats loaded count=${dynamics.size}`);
let historyStats = new Map();
let historySchemaReady = false;
let historyStatsLoading = false;
let historyStatsLastLoadedAt = null;
let historyStatsLastError = null;
let historyStatsLastDurationMs = null;
const historyStatsRefreshIntervalMs = 30 * 60 * 1000;
const previousMarket = new Map();

const logPath = path.join(logsDir, 'server.log');
let logStream = fs.createWriteStream(logPath, { flags: 'a' });
for (const method of ['log', 'warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    original(...args);
    try {
      const level = method.toUpperCase();
      logStream.write(`${new Date().toISOString()} [${level}] ${args.map((x) => typeof x === 'string' ? x : util.inspect(x, { depth: 4 })).join(' ')}\n`);
    } catch {}
  };
}

process.on('uncaughtException',(error)=>{bootLog(`[fatal] uncaughtException: ${error?.stack||error}`);});
process.on('unhandledRejection',(reason)=>{bootLog(`[fatal] unhandledRejection: ${reason?.stack||reason}`);});

let itemMeta = new Map();
let latestBazaarProducts = {};
let runningPoll = false;
let lastHistoryWrite = 0;
let lastCleanup = 0;
let previousSnapshotTs = null;
let switching = false;
let updateApplying = false;
let syncRunning = false;
let shuttingDown=false;
const runtimeTimers=[];
const keepTimer=(timer)=>{runtimeTimers.push(timer);timer.unref?.();return timer;};

function refreshHistoryStatsAsync(reason='scheduled',force=false){
  if(handoff.role==='LAPTOP'||shuttingDown) return Promise.resolve(false);
  const now=Date.now();
  if(historyStatsLoading) return Promise.resolve(false);
  if(!force && historyStatsLastLoadedAt && now-historyStatsLastLoadedAt<historyStatsRefreshIntervalMs) return Promise.resolve(false);
  historyStatsLoading=true;
  historyStatsLastError=null;
  const started=Date.now();
  console.log(`[history] background 7d stats refresh started; reason=${reason}`);
  return new Promise((resolve)=>{
    let settled=false;
    const worker=new Worker(new URL('./src/history-stats-worker.mjs',import.meta.url),{
      workerData:{dbPath,nowTs:Date.now(),historyIntervalSeconds:config.historyIntervalSeconds}
    });
    const finish=(ok,error=null)=>{
      if(settled)return;
      settled=true;
      historyStatsLoading=false;
      historyStatsLastDurationMs=Date.now()-started;
      if(ok){
        historyStatsLastLoadedAt=Date.now();
        historyStatsLastError=null;
        console.log(`[history] background 7d stats ready in ${historyStatsLastDurationMs}ms; products=${historyStats.size}; reason=${reason}`);
      }else{
        historyStatsLastError=String(error||'Unknown history worker error');
        console.warn(`[history] background 7d stats failed after ${historyStatsLastDurationMs}ms; reason=${reason}; error=${historyStatsLastError}`);
      }
      resolve(ok);
    };
    worker.once('message',(message)=>{
      if(message?.ok){
        historyStats=new Map(Array.isArray(message.entries)?message.entries:[]);
        finish(true);
      }else finish(false,message?.error||'History worker returned an invalid result');
    });
    worker.once('error',(error)=>finish(false,error?.stack||error?.message||error));
    worker.once('exit',(code)=>{if(!settled&&code!==0)finish(false,`History worker exited with code ${code}`);});
  });
}

state.dualSync = { lastSyncAt:null,lastSuccessAt:null,lastError:null,lastErrorType:null,lastTriggerAt:null,lastTransferAt:null,sentSnapshots:0,sentRows:0,acknowledgedSnapshots:0,deletedRows:0,receivedSnapshots:0,receivedRows:0,duplicateSnapshotsIgnored:0,duplicateRowsIgnored:0,droppedBeforeSync:Number(getMeta(db,'laptop_dropped_before_sync')||0),peerReachable:null };
state.bazaarHealth = { consecutiveFailures:0,lastFailureAt:null,lastRecoveryAt:null,lastErrorType:null };

function formatAge(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 0) return 'unknown';
  const seconds=Math.floor(Number(ms)/1000);
  if(seconds<60)return `${seconds}s`;
  const minutes=Math.floor(seconds/60);
  if(minutes<60)return `${minutes}m ${seconds%60}s`;
  const hours=Math.floor(minutes/60);
  return `${hours}h ${minutes%60}m`;
}

function classifyRuntimeError(error) {
  const name=String(error?.name||'');
  const message=String(error?.message||error||'');
  if(name==='AbortError'||/aborted/i.test(message)) return 'ABORT';
  if(/timed out|timeout|ETIMEDOUT/i.test(message)) return 'TIMEOUT';
  if(/ECONNREFUSED/i.test(message)) return 'CONNECTION_REFUSED';
  if(/ECONNRESET/i.test(message)) return 'CONNECTION_RESET';
  if(/EAI_AGAIN|ENOTFOUND/i.test(message)) return 'DNS';
  if(/HTTP\s*401|HTTP\s*403|unauthor/i.test(message)) return 'AUTH';
  if(/HTTP\s*\d+/i.test(message)) return 'HTTP';
  if(/fetch failed|network/i.test(message)) return 'NETWORK';
  return 'OTHER';
}

function currentBazaarHealth(now=Date.now()) {
  const lastGood=Number(state.lastSuccessfulFetchAt)||0;
  const lastMarket=Number(state.lastHypixelUpdate)||0;
  const ageMs=lastGood?Math.max(0,now-lastGood):null;
  const marketAgeMs=lastMarket?Math.max(0,now-lastMarket):null;
  const staleThresholdMs=Math.max(60_000,(Number(config.pollIntervalSeconds)||15)*3000);
  const mode=!lastGood?'STARTING':(state.bazaarHealth.consecutiveFailures>0||ageMs>staleThresholdMs?'LAST_GOOD_SNAPSHOT':'LIVE');
  return {mode,ageMs,marketAgeMs,staleThresholdMs,consecutiveFailures:state.bazaarHealth.consecutiveFailures,lastFailureAt:state.bazaarHealth.lastFailureAt,lastRecoveryAt:state.bazaarHealth.lastRecoveryAt,lastErrorType:state.bazaarHealth.lastErrorType};
}

function diskStats(){ try{ const st=fs.statfsSync(projectRoot); const block=Number(st.bsize||st.frsize||4096); return {freeBytes:Number(st.bavail)*block,totalBytes:Number(st.blocks)*block}; }catch{return {freeBytes:null,totalBytes:null};} }
function pendingSync(){ return handoff.role==='LAPTOP' ? pendingHistoryStats(db, localOriginId) : {snapshots:0,rows:0,oldestTs:null,newestTs:null}; }
function enforceLaptopStoragePolicy(){
  if (!(dualCollectorEnabled && handoff.role==='LAPTOP')) return;
  const minFreeGB=Math.max(1,Number(config.laptopMinimumFreeDiskGB)||10);
  let d=diskStats(); if(d.freeBytes==null || d.freeBytes>=minFreeGB*1024**3) return;
  let dropped=0;
  for(let i=0;i<100 && d.freeBytes<minFreeGB*1024**3;i++){ const x=dropOldestPendingSnapshots(db,localOriginId,10); if(!x.snapshotsDeleted) break; dropped += x.snapshotsDeleted; if(i%5===4){compactDatabase(db); d=diskStats();} }
  if(dropped){ compactDatabase(db); const total=Number(getMeta(db,'laptop_dropped_before_sync')||0)+dropped; setMeta(db,'laptop_dropped_before_sync',total); state.dualSync.droppedBeforeSync=total; console.warn(`[storage] low disk: dropped ${dropped} oldest unsynced laptop snapshots to preserve newer data`); }
}

try {
  if (process.platform === 'win32') os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {}

function resetRuntimeMarketState() {
  latestBazaarProducts = {};
  state.flips = [];
  state.reverseNpcFlips = [];
  state.lastHypixelUpdate = null;
  state.lastFetchAt = null;
  state.lastSuccessfulFetchAt = null;
  state.lastFetchDurationMs = null;
  state.lastError = null;
  state.newSnapshots = 0;
  state.historyWrites = 0;
  state.dynamicsWrites = 0;
  state.skippedForLowMemory = 0;
  state.bazaarHealth = { consecutiveFailures:0,lastFailureAt:null,lastRecoveryAt:null,lastErrorType:null };
  previousMarket.clear();
  previousSnapshotTs = null;
}

function setCollectorActive(active) {
  collectorActive = Boolean(active);
  saveCollectorState(collectorState.filePath, collectorActive);
  state.collectorActive = collectorActive;
}
state.collectorActive = collectorActive;

async function refreshItems() {
  if (!collectorActive) return;
  try {
    const result = await fetchItemMetadata(config.requestTimeoutSeconds * 1000);
    itemMeta = result.map;
    state.itemMetadataLastUpdated = result.lastUpdated;
  } catch (error) {
    console.warn('[items] metadata refresh failed:', error.message);
  }
}

function attachTrend(flip, previous, history, updatedAt) {
  if (!flip) return flip;
  const currentBuy = Number(flip.bestBuyOrder ?? flip.entryPrice);
  const currentSell = Number(flip.bestSellOffer ?? flip.entryPrice);
  const currentMid = Number(flip.currentMid) || (currentBuy + currentSell) / 2;
  const changeFrom = (reference) => reference > 0 && Number.isFinite(currentMid)
    ? ((currentMid - reference) / reference) * 100
    : 0;

  const priceChange1hPercent = changeFrom(Number(history?.ref1hMid) || 0);
  const priceChange24hPercent = changeFrom(Number(history?.ref24hMid) || 0);
  let priceChangePercent = priceChange1hPercent;

  if (!Number(history?.ref1hMid) && previous) {
    const previousMid = (Number(previous.bestBuyOrder) + Number(previous.bestSellOffer)) / 2;
    priceChangePercent = changeFrom(previousMid);
  }

  let priceTrend = 'STABLE';
  if (priceChangePercent > 0.50) priceTrend = 'UP';
  else if (priceChangePercent < -0.50) priceTrend = 'DOWN';

  return {
    ...flip,
    priceTrend,
    priceChangePercent,
    priceChange1hPercent,
    priceChange24hPercent,
    marketUpdatedAt: updatedAt
  };
}

function historyRowsFromProducts(products){const out=[];const depth=(summary,best,pct,side)=>{if(!Array.isArray(summary)||!(best>0))return 0;const boundary=side==='BUY'?best*(1-pct):best*(1+pct);let total=0;for(const level of summary){const price=Number(level?.pricePerUnit)||0,amount=Number(level?.amount)||0;if(!(price>0)||!(amount>0))continue;if(side==='BUY'?price>=boundary:price<=boundary)total+=amount;}return total;};for(const product of Object.values(products||{})){const q=product?.quick_status||{},id=product?.product_id??q.productId;if(!id)continue;const buys=Array.isArray(product?.buy_summary)?product.buy_summary:[],sells=Array.isArray(product?.sell_summary)?product.sell_summary:[],bestBuy=Number(buys[0]?.pricePerUnit)||Number(q.buyPrice)||0,bestSell=Number(sells[0]?.pricePerUnit)||Number(q.sellPrice)||0;out.push({productId:String(id),bestBuyOrder:bestBuy,bestSellOffer:bestSell,weightedBuyPrice:Number(q.buyPrice)||0,weightedSellPrice:Number(q.sellPrice)||0,bestBuyAmount:Number(buys[0]?.amount)||0,bestSellAmount:Number(sells[0]?.amount)||0,buyDepth1Pct:depth(buys,bestBuy,.01,'BUY'),sellDepth1Pct:depth(sells,bestSell,.01,'SELL'),buyDepth5Pct:depth(buys,bestBuy,.05,'BUY'),sellDepth5Pct:depth(sells,bestSell,.05,'SELL'),sellMovingWeek:Number(q.sellMovingWeek)||0,buyMovingWeek:Number(q.buyMovingWeek)||0,sellVolume:Number(q.sellVolume)||0,buyVolume:Number(q.buyVolume)||0,sellOrders:Number(q.sellOrders)||0,buyOrders:Number(q.buyOrders)||0});}return out;}

function effectiveTaxRate(baseRate) {
  const base = Math.max(0, Math.min(0.25, Number(baseRate) || 0));
  const multiplier = Math.max(0, Number(state.taxContext?.multiplier) || 1);
  const flatAddRate = Math.max(0, Number(state.taxContext?.flatAddRate) || 0);
  return Math.max(0, Math.min(0.25, base * multiplier + flatAddRate));
}

async function refreshMayorTaxContext() {
  try {
    state.taxContext = await fetchBazaarTaxContext(config.requestTimeoutSeconds * 1000);
  } catch (error) {
    console.warn('[mayor] tax modifier refresh failed:', error.message);
  }
}

async function refreshUpdateStatus() {
  state.update = await checkForUpdate(UPDATE_MANIFEST_URL, APP_VERSION, Math.min(5_000, config.requestTimeoutSeconds * 1000));
  return state.update;
}

function isTransientBazaarFetchError(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || error || '');
  return name === 'AbortError' || /aborted|timeout|timed out|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

async function fetchBazaarResilient(timeoutMs, fetcher = fetchBazaar, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const requestTimeoutMs = Math.max(20_000, Number(timeoutMs) || 0);
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetcher(requestTimeoutMs);
    } catch (error) {
      lastError = error;
      if (!isTransientBazaarFetchError(error) || attempt === 2) throw error;
      const delayMs = 350 * (attempt + 1);
      console.warn(`[bazaar] transient fetch failure; retrying in ${delayMs} ms: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function pollBazaar() {
  if (!collectorActive || runningPoll) return;
  runningPoll = true;
  const started = performance.now();
  state.lastFetchAt = Date.now();

  try {
    const data = await fetchBazaarResilient(config.requestTimeoutSeconds * 1000);
    state.lastFetchDurationMs = Math.round(performance.now() - started);
    const fetchedAt = Date.now();
    latestBazaarProducts = data.products || {};
    const previousFailures = Number(state.bazaarHealth.consecutiveFailures) || 0;
    const previousErrorType = state.bazaarHealth.lastErrorType;
    state.lastSuccessfulFetchAt = fetchedAt;
    state.lastError = null;
    state.bazaarHealth.consecutiveFailures = 0;
    state.bazaarHealth.lastErrorType = null;
    if (previousFailures > 0) {
      state.bazaarHealth.lastRecoveryAt = fetchedAt;
      const sourceAge = Number(data.lastUpdated) ? Math.max(0, fetchedAt - Number(data.lastUpdated)) : null;
      console.log(`[bazaar] RECOVERED after ${previousFailures} failure(s) [${previousErrorType || 'UNKNOWN'}]; mode=LIVE sourceAge=${formatAge(sourceAge)} fetch=${state.lastFetchDurationMs}ms`);
    }

    if (state.lastHypixelUpdate === data.lastUpdated) return;

    const elapsedMs = previousSnapshotTs == null ? 0 : Math.max(0, data.lastUpdated - previousSnapshotTs);
    const options = {
      taxRate: effectiveTaxRate(config.defaultTaxPercent / 100),
      orderPriceStep: config.orderPriceStep
    };

    const flips = [];
    const reverseNpcFlips = [];
    const currentMarket = new Map();

    for (const product of Object.values(data.products)) {
      const productId = product.product_id ?? product.quick_status?.productId;
      const meta = itemMeta.get(productId);
      const previous = previousMarket.get(productId);
      const history = historyStats.get(productId);
      const analysedRaw = analyseProduct(product, meta, options, dynamics.get(productId), history);

      if (analysedRaw) {
        const analysed = attachTrend(analysedRaw, previous, history, data.lastUpdated);
        flips.push(analysed);
        currentMarket.set(productId, {
          bestBuyOrder: analysed.bestBuyOrder,
          bestSellOffer: analysed.bestSellOffer,
          marginPercent: analysed.marginPercent
        });

        const updated = updateDynamics(previous, currentMarket.get(productId), dynamics.get(productId), elapsedMs);
        dynamics.set(productId, updated);
      }

      const reverseNpcRaw = analyseReverseNpc(product, meta, history);
      if (reverseNpcRaw) reverseNpcFlips.push(attachTrend(reverseNpcRaw, previous, history, data.lastUpdated));
    }

    previousMarket.clear();
    for (const [id, market] of currentMarket) previousMarket.set(id, market);
    previousSnapshotTs = data.lastUpdated;

    flips.sort((a, b) => b.opportunityScore - a.opportunityScore || b.estimatedCoinsPerHour - a.estimatedCoinsPerHour);
    reverseNpcFlips.sort((a, b) => b.estimatedCoinsPerHour - a.estimatedCoinsPerHour || b.netProfitPerUnit - a.netProfitPerUnit);
    state.flips = flips;
    state.reverseNpcFlips = reverseNpcFlips;
    state.lastHypixelUpdate = data.lastUpdated;
    state.newSnapshots += 1;

    const now = Date.now();
    const freeRamMB = os.freemem() / 1024 / 1024;
    const dueHistory = now - lastHistoryWrite >= config.historyIntervalSeconds * 1000;

    if (dueHistory && collectorActive) {
      if (freeRamMB >= effectiveMinimumFreeRamMB) {
        const bucketMs = config.historyIntervalSeconds * 1000;
        const sourceTs = Number(data.lastUpdated) || now;
        const ts = Math.floor(sourceTs / bucketMs) * bucketMs;
        const historyRows = historyRowsFromProducts(data.products);
        insertHistorySnapshot(db, ts, historyRows, localOriginId, { sourceTs, collectedAt: state.lastSuccessfulFetchAt || now, productCount: historyRows.length, effectiveTaxRate: effectiveTaxRate(config.defaultTaxPercent / 100), schemaVersion: 2 });
        saveCompetitionStats(db, dynamics, sourceTs);
        lastHistoryWrite = now;
        state.historyWrites += 1;
        state.dynamicsWrites += 1;
        console.log(`[bazaar] snapshot saved; mode=LIVE source=${new Date(sourceTs).toISOString()} sourceAge=${formatAge(Math.max(0, now-sourceTs))} products=${historyRows.length} fetch=${state.lastFetchDurationMs}ms origin=${localOriginId}`);
        if(handoff.role!=='LAPTOP') void refreshHistoryStatsAsync('snapshot',false);
        enforceLaptopStoragePolicy();
      } else {
        state.skippedForLowMemory += 1;
        console.warn(`[memory] persistence skipped; free RAM ${Math.round(freeRamMB)} MB`);
      }
    }

    if (handoff.role !== 'LAPTOP' && config.historyRetentionDays > 0 && now - lastCleanup > 6 * 60 * 60 * 1000) {
      const cutoff = now - config.historyRetentionDays * 24 * 60 * 60 * 1000;
      const hourlyDays = Math.max(Number(config.historyRetentionDays) || 30, Number(config.hourlyHistoryRetentionDays) || 730);
      const rolled = cleanupHistory(db, cutoff, now - hourlyDays * 24 * 60 * 60 * 1000);
      if (rolled.rawRowsDeleted || rolled.hourlyRowsDeleted) console.log(`[history] rolled up ${rolled.rawRowsDeleted} raw rows and ${rolled.hourlyRowsDeleted} hourly rows; daily archive retained`);
      lastCleanup = now;
    }
  } catch (error) {
    state.lastFetchDurationMs = Math.round(performance.now() - started);
    state.lastError = error instanceof Error ? error.message : String(error);
    state.bazaarHealth.consecutiveFailures = (Number(state.bazaarHealth.consecutiveFailures) || 0) + 1;
    state.bazaarHealth.lastFailureAt = Date.now();
    state.bazaarHealth.lastErrorType = classifyRuntimeError(error);
    const health = currentBazaarHealth();
    console.error(`[bazaar] refresh failed [${state.bazaarHealth.lastErrorType}]; mode=${health.mode}; consecutive=${health.consecutiveFailures}; lastGoodAge=${formatAge(health.ageMs)}; lastMarketAge=${formatAge(health.marketAgeMs)}; fetch=${state.lastFetchDurationMs}ms; error=${state.lastError}`);
  } finally {
    runningPoll = false;
  }
}

async function startCollectorNow() {
  setCollectorActive(true);
  if (!itemMeta.size) await refreshItems();
  await pollBazaar();
}

function pauseCollector() {
  setCollectorActive(false);
  checkpointDatabase(db);
}

function baselinePayload() {
  return {
    version: 1,
    createdAt: Date.now(),
    sourceRole: handoff.role,
    lastHypixelUpdate: state.lastHypixelUpdate,
    competitionStats: [...dynamics.entries()].map(([productId, stats]) => ({ productId, ...stats }))
  };
}

function mapFromBaseline(body) {
  const rows = Array.isArray(body?.competitionStats) ? body.competitionStats : [];
  return new Map(rows.filter((row) => row?.productId).map((row) => [row.productId, {
    observedMs: Number(row.observedMs) || 0,
    entryBetterEvents: Number(row.entryBetterEvents) || 0,
    exitBetterEvents: Number(row.exitBetterEvents) || 0,
    marginSamples: Number(row.marginSamples) || 0,
    marginMean: Number(row.marginMean) || 0,
    marginM2: Number(row.marginM2) || 0,
    updatedTs: Number(row.updatedTs) || Date.now()
  }]));
}

function handoffStatus() {
  return {
    configured: ['DESKTOP', 'LAPTOP'].includes(handoff.role) && Boolean(handoff.peerHost) && Boolean(handoff.token),
    role: handoff.role,
    peerHost: handoff.peerHost,
    handoffPort: handoff.handoffPort,
    collectorActive,
    switching,
    localHistoryRows: historyCount(db),
    projectRoot,
    databasePath: dbPath,
    dualCollectorEnabled,
    syncRunning,
    pendingSync: pendingSync(),
    droppedBeforeSync: Number(getMeta(db,'laptop_dropped_before_sync')||0)
  };
}

function median(values) {
  const list=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!list.length) return 0;
  const mid=Math.floor(list.length/2);
  return list.length%2?list[mid]:(list[mid-1]+list[mid])/2;
}

function historyReliabilitySummary() {
  const threshold=0.80, intervalMs=Math.max(30,Number(config.historyIntervalSeconds)||300)*1000;
  const newest=Number(db.prepare('SELECT MAX(bucket_ts) newest FROM history_snapshot_meta').get()?.newest)||0;
  const cutoff=Math.max(0,newest-7*86400000);
  const stamps=db.prepare('SELECT DISTINCT bucket_ts ts FROM history_snapshot_meta WHERE bucket_ts>=? ORDER BY bucket_ts ASC').all(cutoff).map(r=>Number(r.ts)).filter(Number.isFinite);
  let reliableDepthMs=0,coverage=0,reliableSince=null;
  if(stamps.length){
    const last=stamps[stamps.length-1];
    for(let i=stamps.length-1;i>=0;i--){
      const span=Math.max(intervalMs,last-stamps[i]+intervalMs),expected=Math.max(1,Math.round(span/intervalMs)),actual=stamps.length-i,c=Math.min(1,actual/expected);
      if(c>=threshold){reliableDepthMs=span;coverage=c;reliableSince=stamps[i];}
    }
  }
  const d=Math.max(1,Math.min(7,Math.ceil(reliableDepthMs/86400000)||1));
  const stats=[...historyStats.values()].filter(x=>Number(x?.[`samples${d}d`])>0);
  const reliable=stats.filter(x=>Number(x?.[`coverage${d}d`])>=threshold);
  return {threshold,windowDays:7,products:stats.length,reliableProducts:reliable.length,reliableShare:stats.length?reliable.length/stats.length:0,reliableDepthMs,coverage,reliableSince,newestSnapshotTs:newest||null,snapshotCount:stamps.length};
}

function statusPayload() {
  const memory = process.memoryUsage();
  let dbSize = 0;
  try { dbSize = fs.statSync(dbPath).size; } catch {}
  return {
    version: APP_VERSION,
    ok: Boolean(state.lastSuccessfulFetchAt),
    startedAt: state.startedAt,
    collectorActive,
    handoff: handoffStatus(),
    lastHypixelUpdate: state.lastHypixelUpdate,
    lastFetchAt: state.lastFetchAt,
    lastSuccessfulFetchAt: state.lastSuccessfulFetchAt,
    lastFetchDurationMs: state.lastFetchDurationMs,
    lastError: state.lastError,
    historySchemaReady,
    historyStatsLoading,
    historyStatsLastLoadedAt,
    historyStatsLastError,
    historyStatsLastDurationMs,
    bazaarHealth: currentBazaarHealth(),
    dataMode: currentBazaarHealth().mode,
    snapshotAgeMs: currentBazaarHealth().ageMs,
    marketSnapshotAgeMs: currentBazaarHealth().marketAgeMs,
    productCount: state.flips.length,
    reverseNpcCount: state.reverseNpcFlips.length,
    minionMarketProducts: Object.keys(latestBazaarProducts).length,
    itemMetadataCount: itemMeta.size,
    itemMetadataLastUpdated: state.itemMetadataLastUpdated,
    newSnapshots: state.newSnapshots,
    historyWrites: state.historyWrites,
    dynamicsWrites: state.dynamicsWrites,
    skippedForLowMemory: state.skippedForLowMemory,
    processRamMB: Math.round(memory.rss / 1024 / 1024),
    systemFreeRamMB: Math.round(os.freemem() / 1024 / 1024),
    databaseSizeMB: Math.round((dbSize / 1024 / 1024) * 10) / 10,
    projectRoot,
    databasePath: dbPath,
    logPath,
    competitionProducts: dynamics.size,
    historyProducts: historyStats.size,
    historyReliability: historyReliabilitySummary(),
    taxContext: state.taxContext,
    update: state.update,
    dualSync: state.dualSync,
    pendingSync: pendingSync(),
    config: {
      pollIntervalSeconds: config.pollIntervalSeconds,
      historyIntervalSeconds: config.historyIntervalSeconds,
      historyRetentionDays: config.historyRetentionDays,
      hourlyHistoryRetentionDays: Number(config.hourlyHistoryRetentionDays) || 730,
      minimumFreeRamMB: effectiveMinimumFreeRamMB,
      defaultTaxPercent: config.defaultTaxPercent,
      updateCheckMinutes: Number(config.updateCheckMinutes) || 30,
      autoApplyUpdates: Boolean(config.autoApplyUpdates),
      syncIntervalSeconds: Number(config.syncIntervalSeconds)||60,
      syncBatchSnapshots: Number(config.syncBatchSnapshots)||12,
      laptopMinimumFreeDiskGB: Number(config.laptopMinimumFreeDiskGB)||10
    }
  };
}

function sendJson(res, data, statusCode = 200) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function serveStatic(req, res) {
  const rawPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safe = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safe);
  if (!filePath.startsWith(publicDir)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': ['.html', '.js', '.css'].includes(ext) ? 'no-store, max-age=0' : 'public, max-age=3600' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function peerBaseUrl() {
  const host = String(handoff.peerHost || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!host) throw new Error('Peer computer is not configured. Run setup-handoff.bat first.');
  return `http://${host}:${handoff.handoffPort}`;
}

async function fetchPeerJson(endpoint, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${peerBaseUrl()}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'x-bazaarflipper-token': handoff.token,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Peer returned HTTP ${res.status}`);
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Peer request ${endpoint} timed out after ${timeoutMs} ms`);
    throw error;
  } finally { clearTimeout(timer); }
}

function uploadDatabaseToPeer() {
  return new Promise((resolve, reject) => {
    checkpointDatabase(db);
    const stat = fs.statSync(dbPath);
    const target = new URL(`${peerBaseUrl()}/handoff/import-db`);
    const req = http.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || handoff.handoffPort,
      path: target.pathname,
      headers: {
        'x-bazaarflipper-token': handoff.token,
        'content-type': 'application/octet-stream',
        'content-length': stat.size
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(body.error || `Peer returned HTTP ${res.statusCode}`));
          resolve(body);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(180000, () => req.destroy(new Error('Database transfer timed out')));
    req.on('error', reject);
    fs.createReadStream(dbPath).on('error', reject).pipe(req);
  });
}

async function syncLaptopToDesktop(manual=false){
  if(handoff.role!=='LAPTOP') throw new Error('Only the LAPTOP sends pending snapshots to the desktop.');
  if(syncRunning) {
    const pending=pendingSync();
    console.log(`[sync] push already running; pendingSnapshots=${pending.snapshots} pendingRows=${pending.rows}`);
    return {ok:true,busy:true,cumulative:{...state.dualSync},sentSnapshots:0,sentRows:0,acknowledgedSnapshots:0,deletedRows:0,pendingSync:pending};
  }
  syncRunning=true;
  state.dualSync.lastSyncAt=Date.now();
  const before=pendingSync();
  try{
    let sentSnapshots=0,sentRows=0,acknowledgedSnapshots=0,deletedRows=0;
    const maxBatches=manual?500:8;
    for(let i=0;i<maxBatches;i++){
      const snaps=exportPendingHistorySnapshots(db,localOriginId,Number(config.syncBatchSnapshots)||12);
      if(!snaps.length) break;
      const result=await fetchPeerJson('/handoff/sync/import',{method:'POST',body:JSON.stringify({sourceRole:'LAPTOP',snapshots:snaps})},90000);
      if(!result?.ok) throw new Error('Desktop did not confirm history import.');
      const ack=acknowledgeHistorySnapshots(db,snaps,localOriginId);
      sentSnapshots+=snaps.length;
      sentRows+=snaps.reduce((a,x)=>a+x.rows.length,0);
      acknowledgedSnapshots+=ack.snapshotsDeleted;
      deletedRows+=ack.rowsDeleted;
    }
    if(acknowledgedSnapshots) compactDatabase(db);
    const after=pendingSync();
    const now=Date.now();
    Object.assign(state.dualSync,{lastSuccessAt:now,lastTransferAt:now,lastError:null,lastErrorType:null,peerReachable:true});
    state.dualSync.sentSnapshots+=sentSnapshots;
    state.dualSync.sentRows+=sentRows;
    state.dualSync.acknowledgedSnapshots+=acknowledgedSnapshots;
    state.dualSync.deletedRows+=deletedRows;
    historyStats=new Map();
    if(sentSnapshots>0 || manual) console.log(`[sync] LAPTOP->DESKTOP success; snapshots=${sentSnapshots} rows=${sentRows} acknowledged=${acknowledgedSnapshots}; pending ${before.snapshots}->${after.snapshots} snapshots, ${before.rows}->${after.rows} rows`);
    return {ok:true,cumulative:{...state.dualSync},sentSnapshots,sentRows,acknowledgedSnapshots,deletedRows,pendingSync:after};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const type=classifyRuntimeError(error);
    state.dualSync.lastError=message;
    state.dualSync.lastErrorType=type;
    state.dualSync.peerReachable=false;
    const pending=pendingSync();
    console.warn(`[sync] LAPTOP->DESKTOP failed [${type}]; pendingSnapshots=${pending.snapshots} pendingRows=${pending.rows}; data kept locally; error=${message}`);
    if(manual) throw error;
    return {ok:false,error:message,errorType:type,pendingSync:pending};
  } finally {
    syncRunning=false;
  }
}

async function syncHistoryWithPeer(manual=false){
  if(!dualCollectorEnabled) throw new Error('Dual collector is not configured.');
  if(handoff.role==='LAPTOP') return syncLaptopToDesktop(manual);
  state.dualSync.lastSyncAt=Date.now();
  state.dualSync.lastTriggerAt=Date.now();
  const wasReachable=state.dualSync.peerReachable;
  try {
    const result=await fetchPeerJson(`/handoff/sync/push?wait=${manual?'1':'0'}`,{method:'POST'},manual?10*60*1000:20000);
    Object.assign(state.dualSync,{lastSuccessAt:Date.now(),lastError:null,lastErrorType:null,peerReachable:true});
    if(wasReachable===false) console.log('[sync] DESKTOP->LAPTOP trigger RECOVERED; peer reachable again');
    if(manual) console.log(`[sync] manual DESKTOP->LAPTOP trigger completed; started=${Boolean(result?.started)} busy=${Boolean(result?.busy)}`);
    return result;
  } catch(error) {
    const message=error instanceof Error?error.message:String(error);
    const type=classifyRuntimeError(error);
    state.dualSync.lastError=message;
    state.dualSync.lastErrorType=type;
    state.dualSync.peerReachable=false;
    console.warn(`[sync] DESKTOP->LAPTOP trigger failed [${type}]; this does NOT mean laptop push data was lost; desktop continues; error=${message}`);
    if(manual) throw error;
    return {ok:false,error:message,errorType:type,pendingSync:pendingSync()};
  }
}

async function clearLaptopAfterVerifiedTransfer() {
  pauseCollector();
  resetCollectedData(db);
  dynamics = new Map();
  resetRuntimeMarketState();
  try {
    await new Promise((resolve) => logStream.end(resolve));
    fs.writeFileSync(logPath, '', 'utf8');
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
  } catch {}
}

async function switchCollectorToPeer() {
  if (switching) throw new Error('A handoff is already in progress.');
  if (!['DESKTOP', 'LAPTOP'].includes(handoff.role)) throw new Error('This computer is not configured as DESKTOP or LAPTOP. Run setup-handoff.bat.');
  if (!handoff.peerHost || !handoff.token) throw new Error('Handoff peer is not configured. Run setup-handoff.bat.');
  if (!collectorActive) throw new Error('This computer is passive. Start the handoff from the computer that is currently collecting.');

  switching = true;
  try {
    const peer = await fetchPeerJson('/handoff/status');

    if (handoff.role === 'DESKTOP') {
      if (peer.role !== 'LAPTOP') throw new Error(`Expected LAPTOP peer, but the peer reports ${peer.role}.`);
      if (peer.collectorActive) throw new Error('The laptop is already collecting. Refusing to activate it again.');
      if (Number(peer.localHistoryRows || 0) > 0) throw new Error('The laptop still contains unsent collection data. Switch it back to the desktop first or clear it deliberately.');

      const baseline = baselinePayload();
      pauseCollector();
      try {
        const activated = await fetchPeerJson('/handoff/activate', { method: 'POST', body: JSON.stringify(baseline) }, 60000);
        if (!activated.collectorActive) throw new Error('Laptop did not confirm active collection.');
        return { ok: true, direction: 'DESKTOP_TO_LAPTOP', local: handoffStatus(), peer: activated };
      } catch (error) {
        await startCollectorNow();
        throw error;
      }
    }

    if (peer.role !== 'DESKTOP') throw new Error(`Expected DESKTOP peer, but the peer reports ${peer.role}.`);
    pauseCollector();
    try {
      const result = await uploadDatabaseToPeer();
      if (!result.verified || !result.collectorActive) throw new Error('Desktop did not verify the imported night data. Laptop data was kept.');
      await clearLaptopAfterVerifiedTransfer();
      return { ok: true, direction: 'LAPTOP_TO_DESKTOP', imported: result, local: handoffStatus() };
    } catch (error) {
      await startCollectorNow();
      throw error;
    }
  } finally {
    switching = false;
  }
}

async function handleMainRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/status') return sendJson(res, statusPayload());
  if (url.pathname === '/api/handoff/status') return sendJson(res, handoffStatus());
  if (url.pathname === '/api/handoff/sync' && req.method === 'POST') {
    const result = await syncHistoryWithPeer(true);
    return sendJson(res, result);
  }

  if (url.pathname === '/api/handoff/switch' && req.method === 'POST') {
    const result = await switchCollectorToPeer();
    return sendJson(res, result);
  }
  if (url.pathname === '/api/handoff/pause' && req.method === 'POST') {
    pauseCollector();
    return sendJson(res, handoffStatus());
  }
  if (url.pathname === '/api/handoff/resume' && req.method === 'POST') {
    await startCollectorNow();
    return sendJson(res, handoffStatus());
  }

  if (url.pathname === '/api/minions') {
    const taxPercent = Number(url.searchParams.get('tax') ?? config.defaultTaxPercent);
    const personalTaxRate = Number.isFinite(taxPercent)
      ? Math.max(0, Math.min(25, taxPercent)) / 100
      : config.defaultTaxPercent / 100;
    const taxRate = effectiveTaxRate(personalTaxRate);
    const numberParam = (name, fallback) => {
      const raw = url.searchParams.get(name);
      if (raw == null || String(raw).trim() === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    const options = {
      tier: numberParam('tier', 11),
      count: numberParam('count', 1),
      fuel: url.searchParams.get('fuel') || 'ENCHANTED_LAVA_BUCKET',
      beaconPercent: numberParam('beacon', 0),
      crystalPercent: numberParam('crystal', 0),
      otherSpeedPercent: numberParam('otherSpeed', 0),
      sellMethod: url.searchParams.get('sellMethod') || 'BEST',
      priceMode: url.searchParams.get('priceMode') || 'LIVE',
      collectionIntervalDays: numberParam('collectionIntervalDays', 1),
      compareDays: Math.max(1, Math.min(7, Math.round(numberParam('compareDays', 7)))),
      excludedUpgrades: String(url.searchParams.get('excludedUpgrades') || '').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean),
      family: url.searchParams.get('family') || 'ALL',
      search: url.searchParams.get('search') || '',
      sort: url.searchParams.get('sort') || 'NET',
      horizonDays: 1
    };
    const result = calculateMinionRankings(options, {
      market: latestBazaarProducts,
      historyStats,
      itemMeta,
      taxRate,
      marketUpdatedAt: state.lastHypixelUpdate
    });
    return sendJson(res, {
      ...result,
      personalTaxPercent: personalTaxRate * 100,
      effectiveTaxPercent: taxRate * 100,
      dataMode: currentBazaarHealth().mode,
      status: {
        version: APP_VERSION,
        lastHypixelUpdate: state.lastHypixelUpdate,
        historyProducts: historyStats.size,
        historyReliability: historyReliabilitySummary(),
        historyStatsLoading,
        historyStatsLastLoadedAt,
        historyStatsLastError,
        marketProducts: Object.keys(latestBazaarProducts).length
      }
    });
  }

  if (url.pathname === '/api/flips') {
    const taxPercent = Number(url.searchParams.get('tax') ?? config.defaultTaxPercent);
    const mode = String(url.searchParams.get('mode') ?? 'ORDER').toUpperCase();
    const personalTaxRate = Number.isFinite(taxPercent)
      ? Math.max(0, Math.min(25, taxPercent)) / 100
      : config.defaultTaxPercent / 100;
    const taxRate = effectiveTaxRate(personalTaxRate);

    const source = mode === 'REVERSE_NPC' ? state.reverseNpcFlips : state.flips;
    const flips = source.map((base) => base.flipType === 'REVERSE_NPC' ? base : withTax(base, taxRate));
    return sendJson(res, {
      flips,
      personalTaxPercent: personalTaxRate * 100,
      effectiveTaxPercent: taxRate * 100,
      status: statusPayload()
    });
  }

  if (url.pathname === '/api/update/check') {
    const update = await refreshUpdateStatus();
    return sendJson(res, update);
  }

  if (url.pathname === '/api/update/apply' && req.method === 'POST') {
    if (updateApplying) return sendJson(res, { error: 'An update is already being applied.' }, 409);
    const update = await refreshUpdateStatus();
    if (!update.updateAvailable || !update.manifest) return sendJson(res, { error: 'No newer version is available.', update }, 409);
    updateApplying = true;
    try {
      const staged = await stageUpdate({
        manifest: update.manifest,
        manifestUrl: update.manifestUrl,
        projectRoot: __dirname,
        timeoutMs: Math.max(30_000, config.requestTimeoutSeconds * 2000)
      });
      checkpointDatabase(db);
      const worker = spawn(process.execPath, [
        path.join(__dirname, 'src', 'apply-update.mjs'),
        '--project', __dirname,
        '--staging', staged.stagingRoot,
        '--parent', String(process.pid),
        '--port', String(Number(config.port) || 3210),
        '--host', String(config.host || '127.0.0.1')
      ], { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true });
      worker.unref();
      sendJson(res, { ok: true, restarting: true, version: staged.version });
      setTimeout(() => process.exit(0), 800).unref();
      return;
    } catch (error) {
      updateApplying = false;
      return sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  if (url.pathname.startsWith('/api/history/')) {
    const productId = decodeURIComponent(url.pathname.slice('/api/history/'.length));
    const hours = Math.max(1, Math.min(24 * 14, Number(url.searchParams.get('hours') ?? 24)));
    const since = Date.now() - hours * 60 * 60 * 1000;
    return sendJson(res, { productId, points: getHistory(db, productId, since, 5000) });
  }

  if (serveStatic(req, res)) return;
  sendJson(res, { error: 'Not found' }, 404);
}

async function handleHandoffRequest(req, res) {
  if (!isAuthorized(req, handoff.token)) return sendJson(res, { error: 'Unauthorized handoff request' }, 401);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/handoff/status' && req.method === 'GET') return sendJson(res, handoffStatus());
  if (url.pathname === '/handoff/sync/push' && req.method === 'POST') {
    if (handoff.role !== 'LAPTOP') return sendJson(res,{error:'Only the LAPTOP pushes pending snapshots.'},409);
    if (url.searchParams.get('wait') === '1') return sendJson(res, await syncLaptopToDesktop(true));
    const wasRunning=syncRunning;if(!wasRunning)void syncLaptopToDesktop(false).catch((error)=>console.warn(`[sync] background laptop push wrapper failed [${classifyRuntimeError(error)}]: ${error instanceof Error?error.message:String(error)}`));
    return sendJson(res,{ok:true,started:!wasRunning,busy:wasRunning,pendingSync:pendingSync()});
  }
  if (url.pathname === '/handoff/sync/import' && req.method === 'POST') {
    if (handoff.role !== 'DESKTOP') return sendJson(res,{error:'The LAPTOP never accepts history downloads.'},409);
    const body=await readJsonBody(req,64*1024*1024);
    if(String(body?.sourceRole||'').toUpperCase()!=='LAPTOP') return sendJson(res,{error:'Desktop accepts synced history only from LAPTOP.'},409);
    const imported=importHistorySnapshots(db,body?.snapshots,'LAPTOP');
    if(imported.snapshotsRecorded||imported.rowsInserted) void refreshHistoryStatsAsync('sync-import',true);
    state.dualSync.receivedSnapshots=(state.dualSync.receivedSnapshots||0)+imported.snapshotsRecorded;
    state.dualSync.receivedRows=(state.dualSync.receivedRows||0)+imported.rowsInserted;
    state.dualSync.duplicateSnapshotsIgnored=(state.dualSync.duplicateSnapshotsIgnored||0)+(imported.duplicateSnapshots||0);
    state.dualSync.duplicateRowsIgnored=(state.dualSync.duplicateRowsIgnored||0)+(imported.duplicateRows||0);
    const receivedSnapshots=Array.isArray(body?.snapshots)?body.snapshots.length:0;
    const receivedRows=Array.isArray(body?.snapshots)?body.snapshots.reduce((sum,snap)=>sum+(Array.isArray(snap?.rows)?snap.rows.length:0),0):0;
    console.log(`[sync] DESKTOP import accepted; receivedSnapshots=${receivedSnapshots} receivedRows=${receivedRows} insertedRows=${imported.rowsInserted} newSnapshotMarkers=${imported.snapshotsRecorded}`);
    return sendJson(res,{ok:true,...imported});
  }

  if (url.pathname === '/handoff/activate' && req.method === 'POST') {
    if (handoff.role !== 'LAPTOP') return sendJson(res, { error: 'Only the LAPTOP role accepts activation baselines.' }, 409);
    if (collectorActive) return sendJson(res, { error: 'Laptop collector is already active.' }, 409);
    if (historyCount(db) > 0) return sendJson(res, { error: 'Laptop has unsent history. It will not be overwritten.' }, 409);

    const body = await readJsonBody(req);
    const baseline = mapFromBaseline(body);
    replaceCompetitionStats(db, baseline);
    dynamics = baseline;
    resetRuntimeMarketState();
    await startCollectorNow();
    return sendJson(res, handoffStatus());
  }

  if (url.pathname === '/handoff/import-db' && req.method === 'POST') {
    if (handoff.role !== 'DESKTOP') return sendJson(res, { error: 'Only the DESKTOP role accepts night database imports.' }, 409);
    const incomingPath = path.join(dataDir, `handoff-incoming-${Date.now()}.sqlite`);
    pauseCollector();
    try {
      const bytes = await receiveFile(req, incomingPath);
      const imported = importHandoffDatabase(db, incomingPath);
      if (!imported.verified) return sendJson(res, { error: 'Imported database failed verification.', ...imported }, 500);
      dynamics = loadCompetitionStats(db);
      void refreshHistoryStatsAsync('database-import',true);
      resetRuntimeMarketState();
      await startCollectorNow();
      return sendJson(res, { ok: true, bytes, collectorActive, ...imported });
    } catch (error) {
      console.error('[handoff] import failed:', error.message);
      return sendJson(res, { error: error instanceof Error ? error.message : String(error), collectorActive }, 500);
    } finally {
      try { fs.rmSync(incomingPath, { force: true }); } catch {}
    }
  }

  sendJson(res, { error: 'Not found' }, 404);
}

const host = config.host || '127.0.0.1';
const port = Number(config.port) || 3210;
const handoffPort = Number(handoff.handoffPort || config.handoffPort || 3211);

const server = http.createServer((req, res) => {
  handleMainRequest(req, res).catch((error) => sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500));
});

const handoffServer = http.createServer((req, res) => {
  handleHandoffRequest(req, res).catch((error) => sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500));
});

server.listen(port, host, () => {
  bootLog(`[boot] HTTP server listening on ${host}:${port}; health check can pass before extended migration`);
  console.log(`BazaarFlipper v${APP_VERSION} local server: http://${host}:${port}`);
  console.log(`Project root: ${projectRoot}`);
  console.log(`Collector role: ${handoff.role} · ${collectorActive ? 'ACTIVE' : 'PASSIVE'}${dualCollectorEnabled ? ' · DUAL SYNC' : ''}`);
  console.log(`[startup] core server ready; extended history migration deferred by 5s`);

  const completeStartup = async () => {
    try {
      const migrationStarted=Date.now();
      bootLog('[boot] extended history migration begin');
      ensureExtendedHistorySchema(db);
      historySchemaReady=true;
      bootLog(`[boot] extended history migration complete in ${Date.now()-migrationStarted}ms`);

      if(handoff.role!=='LAPTOP') void refreshHistoryStatsAsync('startup',true);

      await refreshMayorTaxContext();
      void refreshUpdateStatus();
      if (collectorActive) {
        await refreshItems();
        await pollBazaar();
      }
      keepTimer(setInterval(pollBazaar, config.pollIntervalSeconds * 1000));
      keepTimer(setInterval(refreshItems, 6 * 60 * 60 * 1000));
      keepTimer(setInterval(refreshMayorTaxContext, 15 * 60 * 1000));
      keepTimer(setInterval(refreshUpdateStatus, Math.max(5, Number(config.updateCheckMinutes) || 30) * 60 * 1000));
      if(handoff.role!=='LAPTOP') keepTimer(setInterval(()=>{void refreshHistoryStatsAsync('periodic',false);},historyStatsRefreshIntervalMs));
      if (dualCollectorEnabled) {
        const runAutoSync = () => {
          void syncHistoryWithPeer(false).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            const type = classifyRuntimeError(error);
            state.dualSync.lastError = message;
            state.dualSync.lastErrorType = type;
            state.dualSync.peerReachable = false;
            console.warn(`[sync] automatic sync wrapper failed [${type}]; server continues; error=${message}`);
          });
        };
        keepTimer(setTimeout(runAutoSync,5000));
        keepTimer(setInterval(runAutoSync,Math.max(30,Number(config.syncIntervalSeconds)||60)*1000));
      }
      bootLog('[boot] full startup complete');
      console.log('[startup] full initialization complete');
    } catch(error) {
      bootLog(`[fatal] deferred startup failed: ${error instanceof Error?error.stack||error.message:String(error)}`);
      console.error('[startup] deferred initialization failed:',error instanceof Error?error.message:String(error));
    }
  };

  keepTimer(setTimeout(()=>{void completeStartup();},5000));
});

handoffServer.listen(handoffPort, '0.0.0.0', () => {
  console.log(`Handoff listener: port ${handoffPort} (${handoff.token ? 'token protected' : 'NOT CONFIGURED'})`);
});

async function gracefulShutdown(signal='shutdown'){if(shuttingDown)return;shuttingDown=true;collectorActive=false;console.log(`[shutdown] requested by ${signal}; stopping collector, sync and servers`);for(const timer of runtimeTimers){try{clearTimeout(timer);clearInterval(timer);}catch{}}const deadline=Date.now()+5000;while((runningPoll||syncRunning)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));await Promise.allSettled([new Promise(r=>{try{server.close(()=>r());server.closeAllConnections?.();}catch{r();}}),new Promise(r=>{try{handoffServer.close(()=>r());handoffServer.closeAllConnections?.();}catch{r();}})]);try{checkpointDatabase(db);console.log('[shutdown] database checkpoint complete');}catch{}try{db.close();console.log('[shutdown] database closed');}catch{}releaseInstanceLock();try{console.log('[shutdown] servers stopped; BazaarFlipper stopped safely');}catch{}try{logStream.end();}catch{}process.exit(0);}
for(const signal of ['SIGINT','SIGTERM','SIGBREAK','SIGHUP'])process.on(signal,()=>{void gracefulShutdown(signal);});
