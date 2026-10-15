/**
 * Persistent BazaarFlipper runtime supervisor and updater (port 3212).
 * This process is NOT the Bazaar HTTP server. It stays responsive while that
 * process is computing history, restarting, or completely unavailable.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as sqlite from 'node:sqlite';
const {DatabaseSync}=sqlite;
import {checkForUpdate,stageUpdate} from './src/updater.mjs';

const projectRoot=path.dirname(fileURLToPath(import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
const config=()=>{
  try{return JSON.parse(fs.readFileSync(path.join(projectRoot,'config.json'),'utf8'));}
  catch{return {};}
};
const updateRoot=path.join(projectRoot,'data','updates');
const journalPath=path.join(updateRoot,'transaction.json');
const statusPath=path.join(projectRoot,'data','last-update.json');
const logsDir=path.join(projectRoot,'logs');
fs.mkdirSync(updateRoot,{recursive:true});
fs.mkdirSync(logsDir,{recursive:true});
const logPath=path.join(logsDir,'runtime-manager.log');
const log=message=>{try{fs.appendFileSync(logPath,new Date().toISOString()+' '+message+'\n');}catch{};};
const normalize=e=>e instanceof Error?(e.stack||e.message):String(e);
const versionAt=(root=projectRoot)=>{
  try{return String(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version);}
  catch{return 'unknown';}
};
const manifestUrl=()=>config().updateManifestUrl||
  'https://raw.githubusercontent.com/kingame111/bazaarflipper-updates/main/manifest.json';
const serverPort=()=>Number(process.env.BAZAAR_SERVER_PORT||config().port)||3210;
const managerPort=()=>Number(process.env.BAZAAR_MANAGER_PORT)||3212;
const allowedOrigins=()=>new Set([
  'http://127.0.0.1:'+serverPort(),
  'http://localhost:'+serverPort()
]);

export function safeRelativePath(rel){
  if(typeof rel!=='string'||!rel||rel.includes('\\')||rel.startsWith('/')||
    /^[a-z]:/i.test(rel)||rel.split('/').some(s=>!s||s==='.'||s==='..')||
    rel==='config.json'||rel.startsWith('data/')||rel.startsWith('logs/')){
    throw new Error('Unsafe update target: '+rel);
  }
  return rel;
}
function atomicWrite(target,bytes){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.swap-'+process.pid;
  try{
    fs.writeFileSync(temporary,bytes);
    // Do not unlink target; a same-directory rename avoids a missing-file window.
    fs.renameSync(temporary,target);
  }finally{try{fs.rmSync(temporary,{force:true});}catch{}}
}
function saveJson(target,value){atomicWrite(target,Buffer.from(JSON.stringify(value,null,2)+'\n'));}
const entryPath=(root,rel)=>path.join(root,...safeRelativePath(rel).split('/'));

export function restoreBackup(project,backupRoot,entries){
  for(const {path:rel,existed} of [...entries].reverse()){
    const target=entryPath(project,rel);
    const backup=entryPath(backupRoot,rel);
    if(existed){
      if(!fs.existsSync(backup))throw new Error('Missing recovery backup: '+rel);
      atomicWrite(target,fs.readFileSync(backup));
    }else if(fs.existsSync(target))fs.rmSync(target,{force:true});
  }
}
export function recoverInterruptedUpdate(project=projectRoot){
  const base=path.join(project,'data','updates');
  const journal=path.join(base,'transaction.json');
  if(!fs.existsSync(journal))return false;
  const tx=JSON.parse(fs.readFileSync(journal,'utf8'));
  if(['swapping','verifying','rolling-back'].includes(tx.phase)){
    const expectedBase=path.join(base,'backups')+path.sep;
    if(typeof tx.backupRoot!=='string'||!path.resolve(tx.backupRoot).startsWith(expectedBase))
      throw new Error('Invalid journal backup path');
    restoreBackup(project,tx.backupRoot,tx.entries);
    atomicWrite(journal,Buffer.from(JSON.stringify({...tx,phase:'rolled-back'})));
    fs.rmSync(journal,{force:true});
    return true;
  }
  if(['done','rolled-back','backed-up'].includes(tx.phase)){
    fs.rmSync(journal,{force:true});
    return false;
  }
  throw new Error('Unknown update journal state: '+tx.phase);
}

export function swapStagedFiles({project=projectRoot,stagingRoot,manifest}){
  if(!Array.isArray(manifest?.files)||!manifest.files.length)throw new Error('Invalid manifest files');
  const id=Date.now()+'-'+process.pid;
  const backupRoot=path.join(project,'data','updates','backups','version-'+id);
  const journal=path.join(project,'data','updates','transaction.json');
  if(fs.existsSync(journal))throw new Error('Unresolved update transaction exists');
  const entries=[];
  const seen=new Set();
  fs.mkdirSync(backupRoot,{recursive:true});
  for(const file of manifest.files){
    const rel=safeRelativePath(file.path);
    if(seen.has(rel))throw new Error('Duplicate update file: '+rel);
    seen.add(rel);
    const source=entryPath(stagingRoot,rel);
    if(!fs.existsSync(source))throw new Error('Staging file missing: '+rel);
    const bytes=fs.readFileSync(source);
    if(sha(bytes)!==file.sha256)throw new Error('Staged checksum mismatch: '+rel);
    const target=entryPath(project,rel);
    const existed=fs.existsSync(target);
    if(existed){
      const backup=entryPath(backupRoot,rel);
      fs.mkdirSync(path.dirname(backup),{recursive:true});
      fs.copyFileSync(target,backup);
    }
    entries.push({path:rel,existed});
  }
  const tx={phase:'backed-up',backupRoot,entries,fromVersion:versionAt(project),toVersion:String(manifest.version),at:Date.now()};
  saveJson(journal,tx);
  saveJson(journal,{...tx,phase:'swapping'});
  // A crash after this point triggers an automatic rollback on next launch.
  for(const file of manifest.files){
    const rel=safeRelativePath(file.path);
    atomicWrite(entryPath(project,rel),fs.readFileSync(entryPath(stagingRoot,rel)));
  }
  saveJson(journal,{...tx,phase:'verifying'});
  return tx;
}
export function commitUpdate(project=projectRoot,transaction){
  const journal=path.join(project,'data','updates','transaction.json');
  saveJson(journal,{...transaction,phase:'done'});
  fs.rmSync(journal,{force:true});
}

async function snapshotDatabase(project){
  const databasePath=path.join(project,'data','bazaar.sqlite');
  if(!fs.existsSync(databasePath))return null;
  const size=fs.statSync(databasePath).size;
  try{
    const available=fs.statfsSync(path.dirname(databasePath));
    const free=Number(available.bavail)*Number(available.bsize);
    if(free<Math.ceil(size*1.25)+64*1024*1024)
      throw new Error('Insufficient free disk for a verified SQLite pre-update backup');
  }catch(e){
    if(/Insufficient/.test(e.message))throw e;
    // statfs can be unavailable on older Windows Node versions.
    log('disk availability could not be preflighted: '+e.message);
  }
  const backupDir=path.join(project,'data','updates','database-backups');
  fs.mkdirSync(backupDir,{recursive:true});
  const target=path.join(backupDir,'pre-update-'+Date.now()+'-'+process.pid+'.sqlite');
  let db;
  try{
    db=new DatabaseSync(databasePath,{readOnly:true});
    if(typeof sqlite.backup==='function')await sqlite.backup(db,target);
    else db.exec("VACUUM INTO '"+target.replace(/'/g,"''")+"'");
    const check=new DatabaseSync(target,{readOnly:true});
    try{
      const result=check.prepare('PRAGMA quick_check').get();
      if(Object.values(result||{})[0]!=='ok')throw new Error('Backup failed SQLite quick_check');
    }finally{check.close();}
    log('verified pre-update database backup size='+fs.statSync(target).size+' path='+target);
    return target;
  }catch(error){
    try{fs.rmSync(target,{force:true});}catch{}
    throw new Error('Cannot safely update without a verified database backup: '+normalize(error));
  }finally{try{db?.close();}catch{}}
}

function waitForExit(child,ms){
  if(!child||child.exitCode!==null||child.signalCode!==null)return Promise.resolve(true);
  return new Promise(resolve=>{
    let done=false;
    const finish=x=>{if(done)return;done=true;clearTimeout(timer);child.off('exit',onExit);resolve(x);};
    const onExit=()=>finish(true);
    const timer=setTimeout(()=>finish(false),ms);
    child.on('exit',onExit);
  });
}
function isAlive(child){return child&&child.exitCode===null&&child.signalCode===null;}
async function stopChild(child){
  if(!isAlive(child))return;
  try{child.kill('SIGTERM');}catch{}
  if(await waitForExit(child,12000))return;
  log('server did not exit gracefully; force-stopping child pid='+child.pid);
  if(process.platform==='win32'){
    spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});
  }else{try{child.kill('SIGKILL');}catch{}}
  await waitForExit(child,8000);
  if(isAlive(child))throw new Error('Server process still running; refusing to overwrite program files');
}
async function waitHealth(expected,readyPort,timeoutMs=60000){
  const deadline=Date.now()+timeoutMs;
  let reason='no health response';
  while(Date.now()<deadline){
    try{
      const result=await fetch('http://127.0.0.1:'+readyPort+'/health/ready',
        {cache:'no-store',signal:AbortSignal.timeout(1200)});
      if(result.ok){
        const body=await result.json();
        if(body.version===expected&&body.ready===true)return true;
        reason='unexpected health payload '+JSON.stringify(body);
      }else reason='HTTP '+result.status;
    }catch(e){reason=e?.message||String(e);}
    await sleep(500);
  }
  throw new Error('New server did not become ready: '+reason);
}

export function createRuntimeManager({root=projectRoot,port=managerPort(),dataPort=serverPort(),
    sourceManifestUrl=manifestUrl(),disableServer=false,healthTimeoutMs=60000}={}){
  let child=null,stopping=false,updating=false,restartCount=0,restartTimer=null;
  let manifestCache=null,checkedAt=0,checkBusy=null;
  const state={phase:'idle',lastError:null,lastCompletedVersion:null,updateStartedAt:null,childPid:null};
  const logState=m=>log('[manager] '+m);
  function startServer(){
    if(stopping||updating||disableServer||isAlive(child))return;
    child=spawn(process.execPath,[path.join(root,'server.mjs')],{
      cwd:root,stdio:['ignore','inherit','inherit'],windowsHide:true
    });
    state.childPid=child.pid||null;
    logState('server start pid='+state.childPid+' version='+versionAt(root));
    child.once('exit',(code,signal)=>{
      if(state.childPid===child.pid)state.childPid=null;
      logState('server exited pid='+child.pid+' code='+code+' signal='+signal);
      if(stopping||updating)return;
      restartCount++;
      restartTimer=setTimeout(startServer,Math.min(30000,1500*restartCount));
      restartTimer.unref?.();
    });
    child.once('error',e=>logState('spawn error '+normalize(e)));
  }
  async function stopServer(){
    if(restartTimer){clearTimeout(restartTimer);restartTimer=null;}
    const previous=child;
    await stopChild(previous);
    if(child===previous)child=null;
    state.childPid=null;
  }
  async function check(){
    if(checkBusy)return checkBusy;
    checkBusy=checkForUpdate(sourceManifestUrl,versionAt(root),30000).then(result=>{
      if(!result.error&&result.manifest){manifestCache=result;checkedAt=Date.now();}
      if(result.error)logState('check failed '+result.error);
      return result;
    }).finally(()=>{checkBusy=null;});
    return checkBusy;
  }
  async function update(){
    if(updating)throw new Error('Update already in progress');
    updating=true;state.phase='checking';state.lastError=null;state.updateStartedAt=Date.now();
    let tx=null;
    try{
      const result=(manifestCache?.manifest&&Date.now()-checkedAt<3600000)?
        manifestCache:await check();
      if(!result?.updateAvailable||!result?.manifest)throw new Error(result?.error||'No newer version available');
      state.phase='downloading';
      logState('staging version '+result.manifest.version);
      const staged=await stageUpdate({manifest:result.manifest,manifestUrl:sourceManifestUrl,
        projectRoot:root,timeoutMs:30000});
      state.phase='stopping-server';await stopServer();
      state.phase='backing-up-history';state.lastDatabaseBackup=await snapshotDatabase(root);
      state.phase='swapping';tx=swapStagedFiles({project:root,stagingRoot:staged.stagingRoot,manifest:result.manifest});
      state.phase='verifying';
      updating=false;startServer();updating=true;
      await waitHealth(String(result.manifest.version),dataPort,healthTimeoutMs);
      commitUpdate(root,tx);
      saveJson(path.join(root,'data','last-update.json'),{
        ok:true,version:result.manifest.version,at:Date.now(),backupRoot:tx.backupRoot
      });
      state.lastCompletedVersion=String(result.manifest.version);
      state.phase='success';restartCount=0;manifestCache=null;
      logState('success version '+result.manifest.version);
    }catch(error){
      state.lastError=normalize(error);state.phase='rolling-back';
      logState('update failed '+state.lastError);
      await stopServer().catch(e=>logState('stop failed: '+normalize(e)));
      try{recoverInterruptedUpdate(root);}
      catch(restoreError){
        state.phase='recovery-required';
        state.lastError+='; rollback error: '+normalize(restoreError);
        logState(state.lastError);
        return;
      }
      saveJson(path.join(root,'data','last-update.json'),{
        ok:false,error:state.lastError,failedAt:Date.now()
      });
      state.phase='rolled-back';
      updating=false;startServer();updating=true;
    }finally{updating=false;}
  }
  const statePayload=()=>({...state,managerReady:true,serverRunning:isAlive(child),
    currentVersion:versionAt(root),updateAvailable:manifestCache?.updateAvailable??null,
    latestVersion:manifestCache?.latestVersion??null});
  const api=http.createServer(async(req,res)=>{
    const origin=req.headers.origin;
    if(origin&&![`http://127.0.0.1:${dataPort}`,`http://localhost:${dataPort}`].includes(origin)){
      res.writeHead(403);res.end('Disallowed origin');return;
    }
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
    if(origin)Object.assign(headers,{'access-control-allow-origin':origin,'vary':'Origin',
      'access-control-allow-methods':'GET,POST,OPTIONS',
      'access-control-allow-headers':'content-type'});
    const reply=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));};
    if(req.method==='OPTIONS'){res.writeHead(204,headers);res.end();return;}
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    try{
      if(req.method==='GET'&&pathname==='/status')return reply(200,statePayload());
      if(req.method==='GET'&&pathname==='/check')return reply(200,await check());
      if(req.method==='POST'&&pathname==='/apply'){
        if(updating)return reply(409,{error:'Update already running'});
        if(!manifestCache?.updateAvailable)return reply(409,{error:'Check for updates first'});
        void update().catch(error=>{state.phase='recovery-required';state.lastError=normalize(error);logState(state.lastError);});
        return reply(202,{ok:true,phase:'queued'});
      }
      return reply(404,{error:'Not found'});
    }catch(error){reply(500,{error:normalize(error)});}
  });
  async function open(){
    if(recoverInterruptedUpdate(root))logState('recovered interrupted update; old code restored');
    startServer();
    await new Promise((resolve,reject)=>api.once('error',reject).listen(port,'127.0.0.1',resolve));
    logState('supervisor listening 127.0.0.1:'+port);
    return api.address();
  }
  async function close(){
    stopping=true;
    if(restartTimer)clearTimeout(restartTimer);
    await stopServer();
    await new Promise(resolve=>api.close(resolve));
  }
  return {open,close,check,update,statePayload,stopServer,startServer};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const runtime=createRuntimeManager();
  runtime.open().catch(err=>{log('FATAL '+normalize(err));process.stderr.write(normalize(err)+'\n');process.exitCode=1;});
  const shutdown=()=>void runtime.close().then(()=>process.exit(0)).catch(()=>process.exit(1));
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
}
