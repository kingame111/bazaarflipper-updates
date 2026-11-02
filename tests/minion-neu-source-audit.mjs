import fs from 'node:fs';
import { MINION_DATA } from '../candidate-src/src/minion-data.mjs';

const BASE = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master/items/';
const SOURCE_REPO = 'https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO';
const defs = Object.values(MINION_DATA.definitions);
const requested = defs.flatMap(d => Object.entries(d.tiers || {}).map(([tier, info]) => ({
  name:d.name, id:d.id, tier:Number(tier),
  localSpeed:info.speed, localStorage:info.storage
})));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function get(url) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const res=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'BazaarFlipper independent minion reference audit'}});
      if(res.ok) {
        const body=await res.text();
        try {return {data:JSON.parse(body),httpStatus:res.status};}
        catch {return {error:'Not JSON',status:res.status,head:body.slice(0,150)};}
      }
      if(![429,500,502,503,504].includes(res.status)) return {error:'HTTP '+res.status};
    } catch(e) { if(attempt===2) return {error:String(e)}; }
    await sleep(700*(attempt+1));
  }
  return {error:'Source retries exhausted'};
}
const clean=x=>String(x||'').replace(/§[0-9a-fklmnor]/gi,'');
const result={generatedAt:new Date().toISOString(),sourceRepo:SOURCE_REPO,sourceItemBase:BASE,totalCandidateTiers:requested.length,records:[],summary:{}};
let counter=0;
async function worker(){
  while(counter<requested.length){
    const candidate=requested[counter++];
    const url=BASE+candidate.id+'_'+candidate.tier+'.json';
    const response=await get(url);
    const row={name:candidate.name,id:candidate.id,tier:candidate.tier,url,
      localSpeed:candidate.localSpeed,localStorage:candidate.localStorage};
    if(response.error) {row.status='UNVERIFIED';row.reason=response.error;result.records.push(row);continue;}
    const data=response.data;
    const lore=(Array.isArray(data.lore)?data.lore:[]).map(clean).join(' ');
    const speedMatch=lore.match(/Time Between Actions:\s*(\d+(?:\.\d+)?)s/i);
    const storageMatch=lore.match(/Max Storage:\s*([\d,]+)/i);
    if(String(data.internalname)!==candidate.id+'_'+candidate.tier) {
      row.status='UNVERIFIED';row.reason='Unexpected item identifier '+data.internalname;
    } else if(!speedMatch || !storageMatch) {
      row.status='UNVERIFIED';row.reason='Source lore lacks speed or storage';row.sourceLore=lore.slice(0,300);
    } else {
      row.sourceSpeed=Number(speedMatch[1]);
      row.sourceStorage=Number(storageMatch[1].replaceAll(',',''));
      row.speedMatch=Math.abs(Number(row.localSpeed)-row.sourceSpeed)<0.00001;
      row.storageMatch=Number(row.localStorage)===row.sourceStorage;
      row.status=row.speedMatch&&row.storageMatch?'MATCH':'MISMATCH';
    }
    result.records.push(row);
  }
}
await Promise.all(Array.from({length:12},worker));
result.records.sort((a,b)=>a.name.localeCompare(b.name)||a.tier-b.tier);
result.summary={
  checked:result.records.length,
  verified:result.records.filter(x=>x.status==='MATCH'||x.status==='MISMATCH').length,
  exactMatches:result.records.filter(x=>x.status==='MATCH').length,
  mismatchingSpeeds:result.records.filter(x=>x.speedMatch===false).map(x=>({name:x.name,tier:x.tier,ours:x.localSpeed,source:x.sourceSpeed,url:x.url})),
  mismatchingStorages:result.records.filter(x=>x.storageMatch===false).map(x=>({name:x.name,tier:x.tier,ours:x.localStorage,source:x.sourceStorage,url:x.url})),
  unverified:result.records.filter(x=>x.status==='UNVERIFIED').map(x=>({name:x.name,tier:x.tier,reason:x.reason})),
  familiesWithoutTiers:defs.filter(x=>!Object.keys(x.tiers||{}).length).map(x=>x.name)
};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-neu-source-audit-results.json',JSON.stringify(result,null,2)+'\n');
console.log('NEU_REFERENCE_SUMMARY',JSON.stringify({
checked:result.summary.checked,verified:result.summary.verified,exactMatches:result.summary.exactMatches,
speedMismatches:result.summary.mismatchingSpeeds,
storageMismatches:result.summary.mismatchingStorages,
unverified:result.summary.unverified
},null,2));

if(result.summary.verified!==requested.length||result.summary.mismatchingSpeeds.length||result.summary.mismatchingStorages.length||result.summary.unverified.length)throw new Error('NEU tier source audit failed; inspect report artifact');
