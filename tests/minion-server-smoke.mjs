import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve('candidate-src');
const port=43881;
const config={host:'127.0.0.1',port,windowsProjectRoot:'AUTO',minimumFreeRamMB:256,autoApplyUpdates:false,requestTimeoutSeconds:30,pollIntervalSeconds:300,historyIntervalSeconds:300,updateManifestUrl:'https://127.0.0.1/disabled-manifest.json'};
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config));
let output='';
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',b=>{output+=String(b);});child.stderr.on('data',b=>{output+=String(b);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const host='http://127.0.0.1:'+port;
async function request(url){
 const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),10000);
 try{return await fetch(host+url,{signal:ctl.signal});}finally{clearTimeout(t);}
}
try{
 let started=false;
 for(let n=0;n<100;n++){
  if(child.exitCode!==null)throw Error('Server exited prematurely: '+output.slice(-1500));
  try{const r=await request('/api/status');if(r.ok){const status=await r.json();assert.equal(status.version,'0.6.11');started=true;break;}}
  catch{}
  await sleep(100);
 }
 assert.equal(started,true,'Server did not start: '+output.slice(-1000));
 const r=await request('/api/minions?tier=11&fuel=NONE&shipping=NONE&sellMethod=NPC&family=Combat&search=Ghast&optimizeFor=HORIZON&horizonDays=14');
 assert.equal(r.ok,true,'minion API HTTP '+r.status+' '+await r.text());
 const body=await r.json();
 assert.equal(body.rows?.length,1);
 assert.equal(body.rows[0].name,'Ghast Minion');
 assert.equal(body.rows[0].tier,11);
 assert.equal(body.rows[0].storage.capacity,960);
 assert.equal(body.rows[0].horizonDays,14);
 assert.equal(body.rows[0].optimizeFor,'HORIZON');
 assert.equal(body.catalog.minions.length,61);
 const check=await request('/api/minions?tier=11&fuel=NONE&shipping=ENCHANTED_HOPPER&sellMethod=NPC&family=Combat&search=Ghast&optimizeFor=PAYBACK');
 assert.ok(check.ok);
 const second=await check.json();
 assert.equal(second.rows[0].shipping.npcFactor,0.9);
 console.log('PASS HTTP smoke: v0.6.11 startup, 61-family catalog, Ghast T11, hopper and horizon optimizer');
}finally{
 child.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(2000)]);
 fs.rmSync(path.join(root,'config.json'),{force:true});
}
