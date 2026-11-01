import fs from 'node:fs';
import { MINION_DATA } from '../candidate-src/src/minion-data.mjs';

const BASE='https://hypixelskyblock.minecraft.wiki/w/';
const definitions=Object.values(MINION_DATA.definitions);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deEntity=s=>s.replace(/&nbsp;|&#160;|&#xA0;/gi,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
const text=html=>deEntity(html.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
async function request(url){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(24000),headers:{'User-Agent':'BazaarFlipper reference audit 1.0','Accept':'text/html'}});
   if(r.ok)return {html:await r.text()};
   if(![429,500,502,503,504].includes(r.status))return {error:'HTTP '+r.status};
  }catch(e){if(attempt===2)return {error:String(e)}}
  await sleep(900*(attempt+1));
 }
 return {error:'source retry exhausted'};
}
function extract(html){
 const i=html.indexOf('id="Stats"');
 if(i<0)return {reason:'Stats section not found'};
 const start=html.indexOf('<table',i);
 const end=html.indexOf('</table>',start);
 if(start<0||end<0)return {reason:'Stats table not found'};
 const table=html.slice(start,end+8);
 const rows=[];
 for(const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...m[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(x=>text(x[1]));
  if(!cells.length)continue;
  const first=cells[0].match(/^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?:\s|$)/);
  if(!first)continue;
  const roman=['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
  const tier=roman.indexOf(first[1]);
  const joined=cells.join(' ');
  const hasCooldown=joined.match(/Cooldown:\s*([\d.]+)\s*s\b/i);
  const hasBaseTime=joined.match(/([\d.]+)\s*seconds\b/i);
  const speed=hasCooldown?Number(hasCooldown[1]):hasBaseTime?Number(hasBaseTime[1]):null;
  const store=joined.match(/Storage:\s*([\d,]+)/i);
  const alternate=joined.match(/[\d.]+\s*seconds\s+([\d,]{2,5})\b/i);
  const storage=store?Number(store[1].replaceAll(',','')):alternate?Number(alternate[1].replaceAll(',','')):null;
  rows.push({tier,speed,storage,cells:cells.slice(0,3).map(c=>c.slice(0,140))});
 }
 const full=text(html);
 const top=full.indexOf('Collects');
 const topEnd=full.indexOf('Upgrade with',top);
 const collects=top>=0&&topEnd>top?full.slice(top,Math.min(topEnd,top+1300)):'';
 return {rows,collects,tableSize:table.length,tableStart:text(table).slice(0,550)};
}
const result={generatedAt:new Date().toISOString(),source:BASE,totalFamilies:definitions.length,records:[],summary:{}};
let index=0;
async function worker(){
 while(index<definitions.length){
  const d=definitions[index++];
  const url=BASE+encodeURIComponent(d.name.replaceAll(' ','_'));
  const r=await request(url);
  const record={name:d.name,url,localTierCount:Object.keys(d.tiers||{}).length,source:'Hypixel SkyBlock community wiki'};
  if(r.error){record.status='FETCH_FAILED';record.reason=r.error;result.records.push(record);continue}
  const ex=extract(r.html);
  record.sourceTierCount=ex.rows?.length||0;
  record.collects=ex.collects||'';
  record.status='OK';
  if(!ex.rows?.length){record.status='UNVERIFIED';record.reason=ex.reason||'No parseable Stats rows';record.sample=ex.tableStart;}
  else{
   record.tiers=Object.entries(d.tiers||{}).map(([tier,info])=>{
    const t=Number(tier), matches=ex.rows.filter(x=>x.tier===t);
    const source=matches.length===1?matches[0]:null;
    return {tier:t,localSpeed:info.speed,sourceSpeed:source?.speed??null,speedMatch:source?.speed==null?null:Math.abs(Number(info.speed)-source.speed)<.00001,
      localStorage:info.storage,sourceStorage:source?.storage??null,storageMatch:source?.storage==null?null:Number(info.storage)===source.storage,sourceCells:source?.cells||[]};
   });
  }
  if(['Clay Minion','Flower Minion','Red Sand Minion','Fishing Minion','Vampire Minion'].includes(d.name)){
   console.log('EXAMPLE',JSON.stringify({name:d.name,sourceTiers:record.sourceTierCount,tiers:record.tiers?.slice(0,3),sample:ex.tableStart,collects:record.collects.slice(0,500)}));
  }
  result.records.push(record);
 }
}
await Promise.all(Array.from({length:6},worker));
result.records.sort((a,b)=>a.name.localeCompare(b.name));
const tiers=result.records.flatMap(r=>(r.tiers||[]).map(t=>({...t,name:r.name,url:r.url})));
result.summary={
 totalFamilies:definitions.length,sourceTierRows:result.records.reduce((n,r)=>n+(r.sourceTierCount||0),0),
 verifiedSpeedTiers:tiers.filter(t=>t.speedMatch!==null).length,
 mismatchingSpeedTiers:tiers.filter(t=>t.speedMatch===false).map(t=>({name:t.name,tier:t.tier,ours:t.localSpeed,wiki:t.sourceSpeed,url:t.url})),
 unverifiedSpeedTiers:tiers.filter(t=>t.speedMatch===null).map(t=>({name:t.name,tier:t.tier})),
 verifiedStorageTiers:tiers.filter(t=>t.storageMatch!==null).length,
 mismatchingStorageTiers:tiers.filter(t=>t.storageMatch===false).map(t=>({name:t.name,tier:t.tier,ours:t.localStorage,wiki:t.sourceStorage,url:t.url})),
 failedSources:result.records.filter(x=>x.status!=='OK').map(x=>({name:x.name,reason:x.reason}))
};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-tier-source-audit-results.json',JSON.stringify(result,null,2)+'\n');
console.log('WIKI_TIER_AUDIT_SUMMARY',JSON.stringify(result.summary,null,2));
if(result.summary.verifiedSpeedTiers===0)process.exitCode=2;
