// Simulate a REAL v0.6.13 apply-update.mjs installing v0.7.0 into a throwaway copy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'bazaar-legacy-upgrade-'));
const install=path.join(root,'install'),stage=path.join(root,'stage');
fs.mkdirSync(path.join(install,'src'),{recursive:true});
fs.mkdirSync(path.join(install,'data'),{recursive:true});
fs.mkdirSync(stage,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const serverPort=39000+Math.floor(Math.random()*9000),managerPort=serverPort+1;
const logs=[];
let managerPid=null,installer=null;
const put=(file,body)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body)};
const oldInstaller=path.resolve('candidate-src/src/apply-update.mjs');
const filePaths=['server.mjs','runtime-manager.mjs','package.json','config.example.json','start-bazaarflip.bat'];
for(const folder of ['src','public']){
 for(const file of fs.readdirSync(path.join('candidate-src',folder))){
  if(/\.(?:mjs|js|css|html|svg)$/.test(file))filePaths.push(folder+'/'+file);
 }
}
for(const rel of filePaths){
 const dst=path.join(stage,rel);
 fs.mkdirSync(path.dirname(dst),{recursive:true});
 fs.copyFileSync(path.join('candidate-src',rel),dst);
}
put(path.join(stage,'staged-manifest.json'),JSON.stringify({
 version:'0.7.0',files:filePaths.map(path=>({path}))
}));
put(path.join(install,'package.json'),JSON.stringify({version:'0.6.13',type:'module'}));
put(path.join(install,'config.json'),JSON.stringify({
 ...JSON.parse(fs.readFileSync('candidate-src/config.example.json','utf8')),
 port:serverPort,host:'127.0.0.1',autoApplyUpdates:false,
 pollIntervalSeconds:3600,syncIntervalSeconds:3600,historyIntervalSeconds:3600
}));
put(path.join(install,'server.mjs'),"console.log('old version');\n");
const d=new DatabaseSync(path.join(install,'data','bazaar.sqlite'));
d.exec("CREATE TABLE keep_history (value TEXT); INSERT INTO keep_history VALUES ('user-data-preserved')");
d.close();
async function ready(){
 const deadline=Date.now()+60000;
 while(Date.now()<deadline){
  try{
   const res=await fetch('http://127.0.0.1:'+managerPort+'/status',
     {signal:AbortSignal.timeout(1000)});
   if(res.ok){
    const status=await res.json();
    if(status.managerReady&&status.currentVersion==='0.7.0'&&status.serverRunning){
     managerPid=status.managerPid;
     const health=await fetch('http://127.0.0.1:'+serverPort+'/health/ready',
       {signal:AbortSignal.timeout(1000)});
     if(health.ok&&(await health.json()).ready)return;
    }
   }
  }catch{}
  await sleep(350);
 }
 throw Error('No live manager after v0.6.13 update: '+logs.join('\n'));
}
try{
 const env={...process.env,BAZAAR_SERVER_PORT:String(serverPort),
   BAZAAR_MANAGER_PORT:String(managerPort)};
 delete env.BAZAAR_MANAGED_CHILD;
 installer=spawn(process.execPath,[oldInstaller,'--project',install,'--staging',stage,
   '--parent','0','--port',String(serverPort)],{
   cwd:install,env,stdio:['ignore','pipe','pipe']
 });
 for(const st of [installer.stdout,installer.stderr])st.on('data',b=>logs.push(b.toString()));
 const code=await Promise.race([new Promise(resolve=>installer.once('exit',resolve)),
   sleep(70000).then(()=>{throw Error('Legacy installer stalled')})]);
 assert.equal(code,0,'Legacy installer exited incorrectly '+logs.join('\n'));
 await ready();
 const verify=new DatabaseSync(path.join(install,'data','bazaar.sqlite'),{readOnly:true});
 try{assert.equal(verify.prepare('SELECT value FROM keep_history').get().value,'user-data-preserved')}
 finally{verify.close()}
 assert.equal(JSON.parse(fs.readFileSync(path.join(install,'package.json'),'utf8')).version,'0.7.0');
 assert.equal(fs.existsSync(path.join(install,'runtime-manager.mjs')),true);
 console.log(JSON.stringify({PASS:true,legacyUpdater:'0.6.13',newVersion:'0.7.0',
   managerOnline:true,historyPreserved:true}));
}finally{
 try{installer?.kill('SIGTERM')}catch{}
 if(managerPid&&managerPid!==process.pid){
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(managerPid),'/T','/F'],
   {windowsHide:true,stdio:'ignore',timeout:9000});
  else{try{process.kill(managerPid,'SIGTERM')}catch{}}
 }
 await sleep(1200);
 fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:300});
}
