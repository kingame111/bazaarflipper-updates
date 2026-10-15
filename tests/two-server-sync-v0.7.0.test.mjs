import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openDatabase,insertHistorySnapshot,exportPendingHistorySnapshots,pendingHistoryStats} from '../candidate-src/src/db.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-2server-sync-'));
const basePort=44000+(process.pid%1000);
const desktop={root:path.join(tmp,'desktop'),http:basePort,sync:basePort+2,peer:basePort+3,role:'DESKTOP'};
const laptop={root:path.join(tmp,'laptop'),http:basePort+1,sync:basePort+3,peer:basePort+2,role:'LAPTOP'};
const children=new Map(),logLines=[];
const T=Date.now();
const snapshots=Math.max(1,Number(process.env.BAZAAR_SYNC_SNAPSHOTS)||80),products=Math.max(1,Number(process.env.BAZAAR_SYNC_PRODUCTS)||2200);
const stamps=Array.from({length:snapshots},(_,i)=>Math.floor((T-(snapshots-i+100)*300000)/300000)*300000);
const DATA_ID='AUDIT_PRODUCT_';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const baseConfig=JSON.parse(fs.readFileSync('candidate-src/config.example.json','utf8'));
async function request(port,route,method='GET',timeout=15000) {
 const res=await fetch('http://127.0.0.1:'+port+route,{method,cache:'no-store',
   signal:AbortSignal.timeout(timeout)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error('HTTP '+res.status+' '+route+' '+JSON.stringify(data).slice(0,300));
 return data;
}
async function wait(port){
 for(let i=0;i<150;i++){
  try{const x=await request(port,'/health/ready','GET',1000);if(x.ready)return;}
  catch{}
  await sleep(200);
 }
 throw Error('server '+port+' did not become ready: '+logLines.slice(-15).join('\n'));
}
function install(config){
 fs.cpSync('candidate-src',config.root,{recursive:true});
 const handoff={role:config.role,peerHost:'127.0.0.1',
   handoffPort:config.sync,peerPort:config.peer};
 fs.writeFileSync(path.join(config.root,'handoff.json'),JSON.stringify(handoff));
 fs.writeFileSync(path.join(config.root,'handoff.key'),'safe-test-token-not-real-secret');
 fs.writeFileSync(path.join(config.root,'config.json'),JSON.stringify({
   ...baseConfig,port:config.http,host:'127.0.0.1',
   pollIntervalSeconds:3600,historyIntervalSeconds:300,
   syncIntervalSeconds:3600,syncBatchSnapshots:4,
   minimumFreeRamMB:1,laptopMinimumFreeDiskGB:1,
   autoApplyUpdates:false
 }));
}
function start(config){
 const c=spawn(process.execPath,[path.join(config.root,'server.mjs')],{
   cwd:config.root,stdio:['ignore','pipe','pipe']
 });
 for(const stream of [c.stdout,c.stderr])stream.on('data',x=>{
   for(const l of x.toString().split('\n'))if(l.trim()){
     logLines.push(config.role+':'+l.trim());
     if(logLines.length>150)logLines.shift();
   }
 });
 children.set(config.role,c);
 return c;
}
async function stop(config){
 const c=children.get(config.role);
 if(!c)return;
 if(c.exitCode===null){c.kill('SIGTERM');
   await Promise.race([new Promise(resolve=>c.once('exit',resolve)),sleep(7000)]);
   if(c.exitCode===null)c.kill('SIGKILL');
 }
 children.delete(config.role);
 await sleep(250);
}
try{
 install(desktop);install(laptop);
 const rows=Array.from({length:products},(_,i)=>({
   productId:DATA_ID+String(i).padStart(5,'0'),bestBuyOrder:100+i,
   bestSellOffer:110+i,sellMovingWeek:30000,buyMovingWeek:20000,
   sellVolume:1000,buyVolume:2000,sellOrders:3,buyOrders:5
 }));
 let db=openDatabase(path.join(laptop.root,'data','bazaar.sqlite'));
 for(const ts of stamps)insertHistorySnapshot(db,ts,rows,'LAPTOP');
 assert.equal(pendingHistoryStats(db,'LAPTOP').snapshots,snapshots);
 db.close();
 db=openDatabase(path.join(desktop.root,'data','bazaar.sqlite'));
 // A real same-bucket price conflict between different collectors.
 insertHistorySnapshot(db,stamps[0],[{...rows[0],bestBuyOrder:9999}],'DESKTOP');
 db.close();
 start(laptop);await wait(laptop.http);
 const downStart=Date.now();
 try{await request(laptop.http,'/api/handoff/sync','POST',9000);
   throw Error('Expected sync failure when desktop is offline');
 }catch(e){
   assert.match(e.message,/HTTP|fetch|timed out|refused/i);
 }
 db=openDatabase(path.join(laptop.root,'data','bazaar.sqlite'));
 assert.equal(pendingHistoryStats(db,'LAPTOP').snapshots,snapshots,
   'Offline desktop must not delete pending laptop data');
 db.close();
 start(desktop);await wait(desktop.http);
 // Peer handoff API must reject missing/incorrect credentials before touching data.
 const denied=await fetch('http://127.0.0.1:'+desktop.sync+'/handoff/status',
   {signal:AbortSignal.timeout(2000)});
 assert.equal(denied.status,401,'Unprotected LAN peer endpoint exposes synchronization data');
 const authorized=await fetch('http://127.0.0.1:'+desktop.sync+'/handoff/status',{
   headers:{'x-bazaarflipper-token':'safe-test-token-not-real-secret'},
   signal:AbortSignal.timeout(2000)
 });
 assert.equal(authorized.status,200,'Correct peer token must work');
 const forbiddenImport=await fetch('http://127.0.0.1:'+desktop.sync+'/handoff/sync/import',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({sourceRole:'LAPTOP',snapshots:[]}),
   signal:AbortSignal.timeout(2000)
 });
 assert.equal(forbiddenImport.status,401,'Sync import must require a valid token');

 const sent=await request(laptop.http,'/api/handoff/sync','POST',Math.max(150000,snapshots*500));
 assert.ok(sent.ok,JSON.stringify(sent).slice(0,300));
 db=openDatabase(path.join(desktop.root,'data','bazaar.sqlite'));
 const imported=db.prepare("SELECT COUNT(*) n FROM history WHERE product_id LIKE 'AUDIT_PRODUCT_%'").get().n;
 const conflicts=db.prepare("SELECT COUNT(*) n FROM history_observation_conflicts WHERE origin_id='LAPTOP' AND product_id LIKE 'AUDIT_PRODUCT_%'").get().n;
 const allConflicts=db.prepare("SELECT COUNT(*) n FROM history_observation_conflicts WHERE origin_id='LAPTOP'").get().n;
 const preserved=db.prepare('SELECT best_buy_order p FROM history WHERE ts=? AND product_id=?')
   .get(stamps[0],DATA_ID+'00000').p;
 assert.equal(imported,snapshots*products,'All uploaded source observations must exist (except one shared canonical record)');
 assert.equal(conflicts,1,'Conflicting source observation must be retained for audit');
 assert.equal(preserved,9999,'Existing desktop canonical observation should not be silently overwritten');
 assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0],'ok');
 db.close();
 db=openDatabase(path.join(laptop.root,'data','bazaar.sqlite'));
 assert.equal(exportPendingHistorySnapshots(db,'LAPTOP',snapshots).filter(x=>stamps.includes(x.ts)).length,0,
   'Laptop must not retain data after VERIFIED acknowledgement');
 db.close();
 console.log(JSON.stringify({PASS:true,realHttpServers:2,offlineRetryTest:true,
   snapshotCount:snapshots,productsPerSnapshot:products,verifiedRows:imported,
   conflictsRetained:conflicts,allSourceConflicts:allConflicts,peerAuthenticationTested:true,offlineDurationMs:Date.now()-downStart}));
}catch(error){
 console.error('LAST SERVER LOGS\n'+logLines.slice(-35).join('\n'));
 throw error;
}finally{
 await Promise.all([stop(laptop),stop(desktop)]);
 fs.rmSync(tmp,{recursive:true,force:true,maxRetries:6,retryDelay:500});
}
