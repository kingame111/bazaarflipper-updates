import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';

const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
assert.equal(manifest.version,'0.7.0');
const encoded=manifest.bundle.parts.map(p=>fs.readFileSync(p,'utf8').trim()).join('');
const packed=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')).toString('utf8'));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-packed-v070-'));
const port=34000+Math.floor(Math.random()*1000),managerPort=port+2000;
for(const [name,base64] of Object.entries(packed.files)){
 const full=path.join(root,name);
 fs.mkdirSync(path.dirname(full),{recursive:true});
 fs.writeFileSync(full,Buffer.from(base64,'base64'));
}
const testConfig=JSON.parse(fs.readFileSync(path.join(root,'config.example.json'),'utf8'));
testConfig.port=port;
testConfig.host='127.0.0.1';
testConfig.autoApplyUpdates=false;
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(testConfig));
const logs=[];
const child=spawn(process.execPath,[path.join(root,'runtime-manager.mjs')],{
 cwd:root,env:{...process.env,BAZAAR_MANAGER_PORT:String(managerPort),
   BAZAAR_SERVER_PORT:String(port)},stdio:['ignore','pipe','pipe']
});
child.stdout.on('data',x=>logs.push(x.toString()));
child.stderr.on('data',x=>logs.push(x.toString()));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(url,predicate,limit=30000){
 const deadline=Date.now()+limit;
 while(Date.now()<deadline){
  if(child.exitCode!==null)throw Error('Manager exited '+child.exitCode+'\n'+logs.join(''));
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(1800)});
   if(response.ok){
    const json=await response.json();
    if(predicate(json))return json;
   }
  }catch{}
  await sleep(250);
 }
 throw Error('Timeout '+url+'\n'+logs.join('').slice(-5000));
}
try{
 const manager=await waitFor('http://127.0.0.1:'+managerPort+'/status',x=>x.managerReady&&x.serverRunning);
 assert.equal(manager.currentVersion,'0.7.0');
 const live=await waitFor('http://127.0.0.1:'+port+'/health/live',x=>x.version==='0.7.0');
 assert.equal(live.ok,true);
 const ready=await waitFor('http://127.0.0.1:'+port+'/health/ready',x=>x.version==='0.7.0'&&x.ready);
 assert.equal(ready.ready,true);
 const status=await waitFor('http://127.0.0.1:'+port+'/api/status',x=>x.version==='0.7.0');
 assert.equal(status.version,'0.7.0');
 const minions=await waitFor('http://127.0.0.1:'+port+'/api/minions?search=Ghast',x=>Array.isArray(x.rows),35000);
 assert.ok(minions.rows.some(x=>x.name==='Ghast Minion'));
 console.log(JSON.stringify({pass:true,packedFiles:Object.keys(packed.files).length,managerReady:true,
   databaseReady:true,minionWorkerReady:true,sourceVersion:status.version}));
}finally{
 try{child.kill('SIGTERM');}catch{}
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(12000)]);
 if(child.exitCode===null){try{child.kill('SIGKILL');}catch{}}
 fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:500});
}
