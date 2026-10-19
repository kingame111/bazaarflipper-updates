import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {createRuntimeManager,recoverInterruptedUpdate,swapStagedFiles} from '../candidate-src/runtime-manager.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-supervisor-integration-'));
const serverPort=34521;
const manifestUrl='https://raw.githubusercontent.com/testing/local/main/manifest.json';
const p=name=>path.join(tmp,name);
const response=s=>new Response(s,{status:200});
const write=(name,s)=>{fs.mkdirSync(path.dirname(p(name)),{recursive:true});fs.writeFileSync(p(name),s);};
const pkg=v=>JSON.stringify({name:'bazaar-fixture',type:'module',version:v});
const server=(bad=false)=>[
  "import http from 'node:http';",
  "import fs from 'node:fs';",
  "const pkg=JSON.parse(fs.readFileSync(new URL('./package.json',import.meta.url),'utf8'));",
  "http.createServer((req,res)=>{",
  "  if(req.url==='/health/ready'){",
  "    res.setHeader('content-type','application/json');",
  "    res.end(JSON.stringify({version:pkg.version,ready:"+(!bad)+"}));return;",
  "  }res.end('pong');",
  "}).listen("+serverPort+",'127.0.0.1');",
  "setInterval(()=>{},10000);"
].join('\n');
const build=(ver,files)=>{
 const archive=gzipSync(Buffer.from(JSON.stringify({files:Object.fromEntries(
   Object.entries(files).map(([name,s])=>[name,Buffer.from(s).toString('base64')]))})));
 const encoded=archive.toString('base64'),mid=Math.floor(encoded.length/2);
 return {manifest:{version:ver,files:Object.entries(files).map(([name,s])=>({
   path:name,sha256:sha(Buffer.from(s))
 })),bundle:{encoding:'gzip-base64',sha256:sha(archive),parts:[
   './releases/'+ver+'/part-001.txt','./releases/'+ver+'/part-002.txt'
 ]}},chunks:[encoded.slice(0,mid),encoded.slice(mid)]};
};
let manager=null,base='',activeManifest,activeChunks;
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 const u=String(url);
 if(u.startsWith('http://127.0.0.1:'))return realFetch(url,options);
 if(u===manifestUrl)return response(JSON.stringify(activeManifest));
 if(u.endsWith('part-001.txt'))return response(activeChunks[0]);
 if(u.endsWith('part-002.txt'))return response(activeChunks[1]);
 throw Error('Unexpected URL '+u);
};
async function poll(predicate,maxMs=16000){
 const until=Date.now()+maxMs;
 while(Date.now()<until){
  const value=await predicate();if(value)return value;
  await sleep(100);
 }
 throw Error('Timed out waiting for manager operation');
}
try{
 write('package.json',pkg('0.6.13'));
 write('server.mjs',server());
 fs.mkdirSync(p('data'),{recursive:true});
 const proofDb=new DatabaseSync(p('data/bazaar.sqlite'));
 proofDb.exec("CREATE TABLE user_history (value TEXT); INSERT INTO user_history VALUES ('CRITICAL HISTORY');");
 proofDb.close();
 const checkHistory=()=>{
   const d=new DatabaseSync(p('data/bazaar.sqlite'),{readOnly:true});
   try{return d.prepare('SELECT value FROM user_history').get()?.value;}
   finally{d.close();}
 };
 write('config.json','{"userConfig":true}');
 const freePort=http.createServer();
 await new Promise(resolve=>freePort.listen(0,'127.0.0.1',resolve));
 const managerPort=freePort.address().port;
 await new Promise(resolve=>freePort.close(resolve));
 manager=createRuntimeManager({root:tmp,port:managerPort,dataPort:serverPort,
   sourceManifestUrl:manifestUrl,healthTimeoutMs:2500});
 await manager.open();base='http://127.0.0.1:'+managerPort;
 await poll(async()=>await realFetch('http://127.0.0.1:'+serverPort+'/health/ready').then(r=>r.ok).catch(()=>false));
 // Crash before readiness verification must recover code from the journal.
 const stage=p('data/updates/temp');fs.mkdirSync(stage,{recursive:true});
 fs.writeFileSync(path.join(stage,'server.mjs'),'incomplete');
 const simulated={version:'0.6.14',files:[{path:'server.mjs',sha256:sha(Buffer.from('incomplete'))}]};
 swapStagedFiles({project:tmp,stagingRoot:stage,manifest:simulated});
 assert.equal(fs.readFileSync(p('server.mjs'),'utf8'),'incomplete');
 assert.equal(recoverInterruptedUpdate(tmp),true);
 assert.equal(fs.readFileSync(p('server.mjs'),'utf8'),server());
 // Healthy update: supervisor remains reachable throughout server restart.
 ({manifest:activeManifest,chunks:activeChunks}=build('0.7.0',{
   'server.mjs':server(),'package.json':pkg('0.7.0')
 }));
 assert.equal((await realFetch(base+'/check').then(r=>r.json())).updateAvailable,true);
 const accepted=await realFetch(base+'/apply',{method:'POST'});
 assert.equal(accepted.status,202);
 const fast=Date.now();
 assert.equal((await realFetch(base+'/status').then(r=>r.json())).managerReady,true);
 assert.ok(Date.now()-fast<2000);
 await poll(async()=>{
  const s=await realFetch(base+'/status').then(r=>r.json());
  if(['rolled-back','recovery-required'].includes(s.phase))throw Error(s.lastError);
  return s.phase==='success'&&s;
 });
 assert.equal(JSON.parse(fs.readFileSync(p('package.json'),'utf8')).version,'0.7.0');
 assert.equal(checkHistory(),'CRITICAL HISTORY');
 assert.ok((await realFetch(base+'/status').then(r=>r.json())).lastDatabaseBackup);
 assert.equal(JSON.parse(fs.readFileSync(p('config.json'),'utf8')).userConfig,true);
 // Unhealthy update must restore exact previous software, preserving user data.
 ({manifest:activeManifest,chunks:activeChunks}=build('0.7.1',{
   'server.mjs':server(true),'package.json':pkg('0.7.1')
 }));
 assert.equal((await realFetch(base+'/check').then(r=>r.json())).updateAvailable,true);
 assert.equal((await realFetch(base+'/apply',{method:'POST'})).status,202);
 await poll(async()=>{
  const s=await realFetch(base+'/status').then(r=>r.json());
  if(s.phase==='recovery-required')throw Error(s.lastError);
  return s.phase==='rolled-back'&&s;
 },14000);
 assert.equal(JSON.parse(fs.readFileSync(p('package.json'),'utf8')).version,'0.7.0');
 assert.equal(checkHistory(),'CRITICAL HISTORY');
 assert.equal((await realFetch(base+'/apply',{method:'POST',headers:{origin:'https://evil.example'}})).status,403);
 console.log(JSON.stringify({passed:true,successfulUpdate:true,automaticRollback:true,
   interruptedSwapRecovery:true,independentStatus:true,dataPreserved:true}));
}finally{
 globalThis.fetch=realFetch;
 if(manager)await manager.close().catch(()=>{});
 fs.rmSync(tmp,{recursive:true,force:true});
}
