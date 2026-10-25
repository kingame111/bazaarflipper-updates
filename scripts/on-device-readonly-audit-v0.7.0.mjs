#!/usr/bin/env node
/**
 * Read-only diagnostics for the user's REAL Windows desktop/laptop.
 * Does not stop the service, write to project files, touch snapshots or show peer tokens.
 * Usage:
 *   node scripts/on-device-readonly-audit-v0.7.0.mjs F:\bazzarFlipper
 * Prefer running on each machine with its local installation path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=path.resolve(process.argv[2]||process.cwd());
const started=Date.now(), timeoutMs=3500;
const readJson=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}};
const pkg=readJson(path.join(root,'package.json'))||{};
const config=readJson(path.join(root,'config.json'))||{};
const handoff=readJson(path.join(root,'handoff.json'))||{};
const dataDir=path.join(root,'data');
const dbPath=path.join(dataDir,'bazaar.sqlite');
const port=Number(config.port)||3210;
const managerPort=Number(process.env.BAZAAR_MANAGER_PORT)||3212;
const output={
  report:'BazaarFlipper local read-only audit',
  createdAt:new Date().toISOString(),
  platform:process.platform,
  architecture:process.arch,
  nodeVersion:process.version,
  packageVersion:String(pkg.version||'unknown'),
  collectorRole:String(handoff.role||'UNCONFIGURED'),
  localHttpPort:port,
  localManagerPort:managerPort,
  databaseExists:fs.existsSync(dbPath),
  databaseBytes:fs.existsSync(dbPath)?fs.statSync(dbPath).size:null,
  freeDiskGB:null,
  freeRamMB:Math.floor(os.freemem()/1024/1024),
  server:null,
  manager:null,
  remotePeer:null
};
try{
  const st=fs.statfsSync(dataDir);
  output.freeDiskGB=Math.round(Number(st.bsize)*Number(st.bavail)/1024**3*100)/100;
}catch(error){output.diskCheckError=error.code||error.message;}
async function query(url,headers={}){
  const response=await fetch(url,{cache:'no-store',headers,signal:AbortSignal.timeout(timeoutMs)});
  const body=await response.json().catch(()=>({}));
  return {status:response.status,body};
}
function redactPeer(response){
  const x=response?.body||{};
  return {status:response.status,authorized:response.status===200,
    remoteRole:x.role||null,remoteCollectorActive:x.collectorActive??null,
    remoteQueueSnapshots:x.pendingSync?.snapshots??null};
}
try{
  const response=await query('http://127.0.0.1:'+port+'/api/status');
  const status=response.body||{};
  output.server={
    httpStatus:response.status,version:status.version||null,
    collectorActive:status.collectorActive??null,
    bazaarMode:status.bazaarHealth?.mode||status.dataMode||null,
    lastHypixelAgeSeconds:status.lastHypixelUpdate?Math.floor((Date.now()-status.lastHypixelUpdate)/1000):null,
    historyReady:status.historySchemaReady??null,
    historyLoadError:status.historyStatsLastError??null,
    lastHistoryComputeMs:status.historyStatsLastDurationMs??null,
    unsentSnapshots:status.handoff?.pendingSync?.snapshots??null,
    unsentRows:status.handoff?.pendingSync?.rows??null,
    lastSyncAt:status.dualSync?.lastSyncAt||null,
    lastVerifiedTransferAt:status.dualSync?.lastTransferAt||null,
    lastSyncError:status.dualSync?.lastError?String(status.dualSync.lastError).slice(0,180):null,
    skippedForLowDisk:status.skippedForLowDisk??null
  };
}catch(error){output.server={reachable:false,error:error?.name||error?.code||error?.message};}
try{
  const response=await query('http://127.0.0.1:'+managerPort+'/status');
  const m=response.body||{};
  output.manager={httpStatus:response.status,ready:m.managerReady??null,
    running:m.serverRunning??null,phase:m.phase||null,
    currentVersion:m.currentVersion||null};
}catch(error){output.manager={reachable:false,error:error?.name||error?.code||error?.message};}
const secretPath=path.join(root,'handoff.key');
let token='';
try{token=fs.readFileSync(secretPath,'utf8').trim();}catch{}
let hostname=String(handoff.peerHost||'').trim().replace(/^https?:\/\//,'').replace(/\/$/,'');
const peerPort=Number(handoff.peerPort)||Number(handoff.handoffPort)||Number(config.handoffPort)||3211;
if(hostname&&token){
  if(!/^[a-z0-9.:\-\[\]]+$/i.test(hostname))output.remotePeer={error:'Invalid peer hostname format'};
  else{
    try{
      const response=await query('http://'+hostname+':'+peerPort+'/handoff/status',{'x-bazaarflipper-token':token});
      output.remotePeer=redactPeer(response);
    }catch(error){output.remotePeer={reachable:false,error:error?.name||error?.code||error?.message};}
  }
}else output.remotePeer={configured:false,reason:!hostname?'Missing peer hostname':'Missing peer token'};
output.elapsedMs=Date.now()-started;
// Never write or print the authentication token, peer hostname, full project path, config,
 // environment variables, or the complete /api/status response.
console.log(JSON.stringify(output,null,2));
