import fs from 'node:fs';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
const url='https://api.hypixel.net/v2/resources/skyblock/items';
const res=await fetch(url,{signal:AbortSignal.timeout(60000),headers:{'User-Agent':'BazaarFlipper-independent-NPC-price-audit'}});
if(!res.ok)throw new Error('Official Hypixel items API returned HTTP '+res.status);
const source=await res.json();
if(!source.success||!Array.isArray(source.items))throw new Error('Unexpected official API response');
const api=new Map(source.items.map(x=>[x.id,x]));
const all=[
 ...Object.values(MINION_DATA.definitions).flatMap(d=>(d.drops||[]).map(row=>({minion:d.name,...row}))),
 ...Object.entries(MINION_DATA.upgrades).flatMap(([id,u])=>[
  ...(u.extraDrops||[]).map(row=>({minion:'UPGRADE:'+id,...row})),
  ...(u.cooldownDrop?[{minion:'UPGRADE:'+id,...u.cooldownDrop}]:[]),
  ...(u.dropTransforms||[]).map(row=>({minion:'TRANSFORM:'+id,item:row.to,npc:row.npc}))
 ]),
 ...Object.entries(MINION_DATA.fuels).flatMap(([id,f])=>(f.forceDrops||[]).map(row=>({minion:'FUEL:'+id,...row})))
];
const normalized=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const aliases=new Map();
for(const item of source.items){let k=normalized(item.name);if(!aliases.has(k))aliases.set(k,[]);aliases.get(k).push(item);}
const recs=all.map(row=>{
 let src=api.get(row.item),method=src?'EXACT_ID':'NOT_FOUND';
 if(!src){const possible=aliases.get(normalized(row.item))||[];if(possible.length===1){src=possible[0];method='NAME_NORMALIZED';}}
 const base={minion:row.minion,localId:row.item,localNpc:row.npc,apiId:src?.id||null,apiName:src?.name||null,apiNpc:src?.npc_sell_price??null,method};
 if(src&&Number.isFinite(Number(src.npc_sell_price))&&Number.isFinite(Number(row.npc))){base.equal=Number(src.npc_sell_price)===Number(row.npc);}
 return base;
});
const report={time:new Date().toISOString(),source:url,officialItemCount:source.items.length,records:recs,summary:{
 totalDrops:recs.length,foundExactId:recs.filter(r=>r.method==='EXACT_ID').length,foundByName:recs.filter(r=>r.method==='NAME_NORMALIZED').length,
 noSource:recs.filter(r=>!r.apiId),exactPriceMismatches:recs.filter(r=>r.method==='EXACT_ID'&&r.equal===false),
 namePriceMismatches:recs.filter(r=>r.method==='NAME_NORMALIZED'&&r.equal===false),matches:recs.filter(r=>r.equal===true).length
}};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-npc-api-source-audit-results.json',JSON.stringify(report,null,2)+'\n');
console.log('NPC_SOURCE_AUDIT_SUMMARY',JSON.stringify(report.summary,null,2));
