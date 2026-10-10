import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const hash=b=>createHash('sha256').update(b).digest('hex');
const paths=Array.from({length:16},(_,i)=>'releases/0.6.9/part-'+String(i+1).padStart(3,'0')+'.txt');
const old=JSON.parse(gunzipSync(Buffer.from(paths.map(p=>fs.readFileSync(p,'utf8').trim()).join(''),'base64')).toString('utf8')).files;
const base=Object.fromEntries(Object.entries(old).map(([k,v])=>[k,Buffer.from(v,'base64').toString('utf8')]));
function once(s,a,b,name){let n=s.split(a).length-1;if(n!==1)throw Error(name+' matches='+n);return s.replace(a,b)}
let srv=base['server.mjs'];
srv=once(srv,'const historyStatsRefreshIntervalMs = 30 * 60 * 1000;',
'const historyStatsRefreshIntervalMs = 30 * 60 * 1000;\nlet historyImportRefreshTimer=null;\nlet historyImportQueuedBatches=0;\nlet syncRetryAfter=0;\nlet syncConsecutiveFailures=0;\nlet lastSyncBusyLogAt=0;','state');
srv=once(srv,'state.dualSync = { lastSyncAt:null',[
'function scheduleHistoryImportRefresh(){',
'  if(shuttingDown)return;',
'  historyImportQueuedBatches++;',
'  if(historyImportRefreshTimer)clearTimeout(historyImportRefreshTimer);',
'  const flush=()=>{',
'    historyImportRefreshTimer=null;',
'    if(shuttingDown)return;',
'    if(historyStatsLoading){',
'      historyImportRefreshTimer=setTimeout(flush,5000);',
'      historyImportRefreshTimer.unref?.();return;',
'    }',
'    const n=historyImportQueuedBatches;historyImportQueuedBatches=0;',
"    console.log('[history] coalesced '+n+' import batches');",
"    void refreshHistoryStatsAsync('sync-import-coalesced',true);",
'  };',
'  historyImportRefreshTimer=setTimeout(flush,45000);',
'  historyImportRefreshTimer.unref?.();',
'}','','state.dualSync = { lastSyncAt:null'].join('\n'),'scheduler');
srv=once(srv,'const d=Math.max(1,Math.min(7,Math.ceil(reliableDepthMs/86400000)||1));',
'const d=Math.max(1,Math.min(7,Math.floor(reliableDepthMs/86400000)||1));','history floor');
srv=once(srv,'return {threshold,windowDays:7,products:stats.length,reliableProducts:reliable.length,reliableShare:stats.length?reliable.length/stats.length:0,reliableDepthMs,coverage,reliableSince,newestSnapshotTs:newest||null,snapshotCount:stamps.length};',
'return {threshold,windowDays:7,selectedCoverageWindowDays:d,products:stats.length,reliableProducts:reliable.length,reliableShare:stats.length?reliable.length/stats.length:0,reliableDepthMs,coverage,reliableSince,newestSnapshotTs:newest||null,snapshotCount:stamps.length};','reliability fields');
srv=once(srv,'historyStatsLastDurationMs,\n    bazaarHealth:','historyStatsLastDurationMs,\n    historyImportQueuedBatches,\n    bazaarHealth:','status');
srv=once(srv,"if(imported.snapshotsRecorded||imported.rowsInserted) void refreshHistoryStatsAsync('sync-import',true);","if(imported.snapshotsRecorded||imported.rowsInserted) scheduleHistoryImportRefresh();",'import refresh');
const tick=String.fromCharCode(96),lhs='    console.log('+tick+'[sync] push already running; pendingSnapshots='+'$'+'{pending.snapshots} pendingRows='+'$'+'{pending.rows}'+tick+');';
srv=once(srv,lhs,'    if(Date.now()-lastSyncBusyLogAt>120000){\n'+lhs+'\n      lastSyncBusyLogAt=Date.now();\n    }','busy log');
srv=once(srv,'  syncRunning=true;\n  state.dualSync.lastSyncAt=Date.now();',
'  if(!manual&&Date.now()<syncRetryAfter)return {ok:false,backoff:true,nextRetryAt:syncRetryAfter,pendingSync:pendingSync()};\n  syncRunning=true;\n  state.dualSync.lastSyncAt=Date.now();','sync backoff entry');
srv=once(srv,'    const now=Date.now();\n    Object.assign(state.dualSync,{lastSuccessAt:now',
'    const now=Date.now();\n    syncConsecutiveFailures=0;syncRetryAfter=0;\n    Object.assign(state.dualSync,{lastSuccessAt:now','sync backoff reset');
srv=once(srv,'    state.dualSync.peerReachable=false;\n    const pending=pendingSync();',
'    state.dualSync.peerReachable=false;\n    syncConsecutiveFailures=Math.min(5,syncConsecutiveFailures+1);\n    syncRetryAfter=Date.now()+Math.min(120000,30000*(2**(syncConsecutiveFailures-1)));\n    const pending=pendingSync();','sync backoff fail');
srv=once(srv,"  if (url.pathname.startsWith('/api/history/')) {",[
"  if (url.pathname === '/api/diagnostics/history' && req.method === 'GET') {",
"    if(!historySchemaReady)return sendJson(res,{ok:false,state:'INITIALIZING'},503);",
"    const counts=db.prepare('SELECT COUNT(*) AS metadataRows, COUNT(DISTINCT bucket_ts) AS distinctSnapshots, MIN(bucket_ts) AS oldest, MAX(bucket_ts) AS newest FROM history_snapshot_meta').get();",
"    const sources=db.prepare('SELECT origin_id AS origin, COUNT(*) AS snapshots FROM history_snapshot_meta GROUP BY origin_id ORDER BY origin_id').all();",
"    return sendJson(res,{ok:true,version:APP_VERSION,historyStatsLoading,historyStatsLastLoadedAt,historyStatsLastError,historyStatsLastDurationMs,historyImportQueuedBatches,reliability:historyReliabilitySummary(),metadata:counts,sources,pendingSync:pendingSync()});",
'  }','',
"  if (url.pathname.startsWith('/api/history/')) {"].join('\n'),'read-only diagnostics');
let html=base['public/index.html'];
const start='el.textContent=h?.reliableProducts?',at=html.indexOf(start),end=html.indexOf('building…',at),after=html.indexOf(';',end);
if(at<0||end<0||after-end>25)throw Error('status UI marker not found');
html=html.slice(0,at)+[
"const label='Freshness: '+ago(s.lastHypixelUpdate)+' · Reliable history: ';",
"if(!s.historySchemaReady)el.textContent=label+'initializing…';",
"else if(s.historyStatsLastError)el.textContent=label+'calculation error';",
"else if(s.historyStatsLoading&&!s.historyStatsLastLoadedAt)el.textContent=label+'calculating…';",
"else if(!h?.snapshotCount)el.textContent=label+'no snapshots yet';",
"else el.textContent=label+span(h.reliableDepthMs)+' · '+Math.round(Number(h.coverage||0)*100)+'% coverage · '+(h.reliableProducts||0)+'/'+(h.products||0)+' reliable products'+(s.historyImportQueuedBatches?' · sync refresh queued':'')+(s.historyStatsLoading?' · updating…':'');"].join('')+html.slice(after+1);
html=html.replaceAll('v=0.6.9','v=0.6.10');
const files={...base,'server.mjs':srv,'public/index.html':html,'package.json':once(base['package.json'],'"version": "0.6.9"','"version": "0.6.10"','version')};
if(Object.keys(files).length!==13)throw Error('expected 13 files');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bf-610-'));
for(const [p,body] of Object.entries(files)){
 const dest=path.join(temp,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,body,'utf8');
 if(/\.(mjs|js)$/.test(p)){let r=spawnSync(process.execPath,['--check',dest],{encoding:'utf8'});if(r.status!==0)throw Error('Syntax '+p+': '+r.stderr)}
}
const encoded=Object.fromEntries(Object.entries(files).map(([p,v])=>[p,Buffer.from(v,'utf8').toString('base64')]));
const zip=gzipSync(Buffer.from(JSON.stringify({files:encoded}),'utf8'),{level:9});
const s=zip.toString('base64'),parts=[];
for(let i=0;i<s.length;i+=16000){let p='releases/0.6.10/part-'+String(parts.length+1).padStart(3,'0')+'.txt';fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s.slice(i,i+16000));parts.push('./'+p)}
const manifest={version:'0.6.10',publishedAt:'2026-10-10T09:50:00+03:00',notes:[
'Reliable history depth and state corrected, avoiding false building status.',
'Expensive history refreshes are combined during snapshot imports.',
'Automatic laptop sync backs off on failure without deleting unacknowledged data.',
'Read-only history diagnostics and clear progress state.',
'Full 13-file release, with Minion calculations unchanged.'
],files:Object.entries(files).map(([p,v])=>({path:p,sha256:hash(Buffer.from(v,'utf8'))})),bundle:{parts,encoding:'gzip-base64',sha256:hash(zip)}};
fs.writeFileSync('manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log('BUILT',manifest.version,'files',manifest.files.length,'parts',parts.length,'gzip',zip.length,'syntax PASS');
