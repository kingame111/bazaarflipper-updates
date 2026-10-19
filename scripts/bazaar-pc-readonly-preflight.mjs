// BazaarFlipper read-only preflight. Does NOT modify application files or databases.
import fs from 'node:fs';
import path from 'node:path';

const checks=[];
let status=null;
const record=async(name,url,ms=12000)=>{
  const began=Date.now();
  try{
    const res=await fetch(url,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(ms)});
    const data=await res.json().catch(()=>null);
    const x={name,ok:res.ok,http:res.status,ms:Date.now()-began};
    if(name==='server'){
      status=data;
      Object.assign(x,{version:data?.version??null,role:data?.handoff?.role??null,
        mode:data?.bazaarHealth?.mode??null,historyProducts:data?.historyProducts??null,
        pendingSnapshots:data?.pendingSync?.snapshots??null,
        pendingRows:data?.pendingSync?.rows??null,
        lastSyncError:data?.dualSync?.lastError?String(data.dualSync.lastError).slice(0,120):null});
    }
    if(name==='market'){
      x.products=data?.success===true&&data?.products&&typeof data.products==='object'?
        Object.keys(data.products).length:0;
      x.ok=x.ok&&x.products>100;
    }
    if(name==='manager')x.phase=data?.phase??null;
    if(name==='flips')x.products=Array.isArray(data?.flips)?data.flips.length:null;
    if(name==='minions')x.rows=Array.isArray(data?.rows)?data.rows.length:null;
    checks.push(x);
  }catch(e){checks.push({name,ok:false,ms:Date.now()-began,
    error:String(e?.message||e).slice(0,150)});}
};
const base='http://127.0.0.1:3210';
await record('server',base+'/api/status');
await record('flips',base+'/api/flips?tax=1.25',20000);
await record('minions',base+'/api/minions?search=Ghast',20000);
await record('healthLive',base+'/health/live',3500);
await record('healthReady',base+'/health/ready',3500);
await record('manager','http://127.0.0.1:3212/status',3500);
await record('market','https://api.hypixel.net/v2/skyblock/bazaar',18000);

const sqlite={name:'sqliteReadOnly',ok:false};
let db;
try{
  if(!status?.databasePath)throw Error('Server did not report a database path');
  const {DatabaseSync}=await import('node:sqlite');
  db=new DatabaseSync(String(status.databasePath),{readOnly:true});
  const before=Date.now();
  const v=db.prepare('PRAGMA quick_check').get();
  sqlite.quickCheck=Object.values(v||{})[0]??null;
  sqlite.elapsedMs=Date.now()-before;
  sqlite.ok=sqlite.quickCheck==='ok';
  sqlite.rows=Number(db.prepare('SELECT COUNT(*) n FROM history').get()?.n??0);
  const size=fs.statSync(status.databasePath).size;
  sqlite.databaseMB=Math.round(size/1048576);
  try{
    const disk=fs.statfsSync(path.dirname(status.databasePath));
    sqlite.diskFreeGB=Math.round(Number(disk.bavail)*Number(disk.bsize)/1073741824*10)/10;
  }catch{}
}catch(e){sqlite.error=String(e?.message||e).slice(0,180)}
finally{try{db?.close()}catch{}}
checks.push(sqlite);
if(String(status?.version??'').startsWith('0.6.')){
  for(const x of checks)if(['manager','healthLive','healthReady'].includes(x.name)&&!x.ok)
    x.expectedUnavailable=true;
}
const result={tool:'BazaarFlipper read-only preflight',date:new Date().toISOString(),
  nodeVersion:process.version,platform:process.platform,checks};
const output=path.resolve(process.cwd(),'bazaar-live-readonly-report.json');
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log('Report:',output);
for(const x of checks)console.log((x.expectedUnavailable?'INFO':x.ok?'PASS':'FAIL'),x.name,x.error??'');
console.log('Review report before sharing. No passwords or handoff tokens were included.');
