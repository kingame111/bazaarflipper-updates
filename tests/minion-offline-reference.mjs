// Independent deterministic-event audit. This is NOT a proof of stochastic drops.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';

const DAY=86400;
const TYPES=Object.values(MINION_DATA.definitions);
const ctx={market:{},historyStats:new Map(),itemMeta:new Map(),taxRate:0,sellMethod:'NPC',priceMode:'LIVE',historyDays:7};

function slotCount(items){let result=0;for(const qty of items.values())if(qty>0)result+=Math.ceil(qty/64);return result;}
function place(pool,slots,item,qty){
  if(!qty)return 0;
  const old=pool.get(item)||0;
  const room=Math.max(0,64*Math.max(0,slots-slotCount(pool)) + ((64-old%64)%64)*(old>0&&old%64!==0?1:0));
  // The existing partial stack is guaranteed to be the only free capacity with no empty slots.
  const inserted=Math.min(qty,room);
  if(inserted)pool.set(item,old+inserted);
  return inserted;
}
function convert(pool,from,to,ratio){
  const available=pool.get(from)||0;
  const newUnits=Math.floor(available/ratio);
  if(!newUnits)return false;
  const remainder=available-newUnits*ratio;
  if(remainder)pool.set(from,remainder);else pool.delete(from);
  const inserted=place(pool,Infinity,to,newUnits);assert.equal(inserted,newUnits);
  return true;
}
function compactInventory(pool,recipes){
  for(const [raw,stages] of recipes){
    let from=raw;
    for(const to of stages){
      convert(pool,from,to.id,to.ratio);
      from=to.id;
    }
  }
}
function itemInfo(raw){
  const prices=new Map([[raw.item,Number(raw.npc||0)]]);
  const stages=[];
  let current=raw.item,price=Number(raw.npc||0),first=Object.entries(raw.enchanted||{})[0];
  const seen=new Set([current]);
  for(let guard=0;first&&guard<8;guard++){
    const [to,r]=first,ratio=Number(r);
    if(!(ratio>0)||seen.has(to))break;
    stages.push({id:to,ratio});
    price*=ratio;prices.set(to,price);current=to;seen.add(to);
    const next=MINION_DATA.compactionNext?.[to];first=next?[next.item,next.ratio]:null;
  }
  return {stages,prices};
}
function simulation(minion,{days=1,compactor=false,largeStorage=true,shipping='NONE',fuel='NONE'}={}){
  const tier=11,base=minion.tiers?.[tier];if(!base)return {unsupported:true};
  const fuelObject=MINION_DATA.fuels[fuel]||MINION_DATA.fuels.NONE;
  if(fuelObject.condition?.family && fuelObject.condition.family!==minion.family)return {unsupported:true};
  if(fuelObject.condition?.name && fuelObject.condition.name!==minion.name)return {unsupported:true};
  const drops=fuelObject.forceDrops||minion.drops||[];
  if(!drops.length||drops.some(x=>x.chance!==1||!Number.isInteger(x.amount)||x.amount<=0))return {unsupported:true};
  const bonuses=Number(fuelObject.speed||0)+(fuel==='EVERBURNING_FLAME'&&minion.family==='Combat'&&minion.name!=='Spider Minion'?0.05:0);
  const step=Number(base.speed)/(1+bonuses)*(minion.harvestOnly?1:2);
  const events=Math.floor(days*DAY/step+1e-8);
  const internalSlots=Number(base.storage)/64,extensionSlots=largeStorage?15:0;
  if(!Number.isInteger(internalSlots)||internalSlots<1)return {unsupported:true};
  const internal=new Map(),extension=new Map(),npcPrices=new Map(),recipes=[];
  for(const d of drops){
    const o=itemInfo(d);
    for(const [id,price] of o.prices)npcPrices.set(id,price);
    recipes.push([d.item,o.stages]);
  }
  let soldToHopper=0,hopperUnits=0;
  const shipRate=shipping==='ENCHANTED_HOPPER'?0.7:shipping==='BUDGET_HOPPER'?0.5:0;
  for(let i=0;i<events;i++){
    for(const d of drops){
      let units=d.amount*Number(fuelObject.drops||1);
      // Model ordinary minion storage first, external 15-slot chest second,
      // automated shipping only if BOTH are full (as documented by Wiki).
      let inMinion=place(internal,internalSlots,d.item,units);units-=inMinion;
      if(units>0&&extensionSlots)units-=place(extension,extensionSlots,d.item,units);
      if(units>0&&shipRate>0){soldToHopper+=units*(npcPrices.get(d.item)||0)*shipRate;hopperUnits+=units;}
    }
    // SC3000 compacts on produce, within minion inventory. Wiki explicitly
    // says it does not compact when handed to a completely full minion.
    if(compactor)compactInventory(internal,recipes);
  }
  let inventoryRevenue=0;
  const valued={};
  for(const p of [internal,extension])for(const [id,qty] of p){
    valued[id]=(valued[id]||0)+qty;
    inventoryRevenue+=qty*(npcPrices.get(id)||0);
  }
  return {events,internalSlots,extensionSlots,inventoryRevenue,hopperRevenue:soldToHopper,
    revenue:inventoryRevenue+soldToHopper,hopperUnits,internalSlotsUsed:slotCount(internal),
    extensionSlotsUsed:slotCount(extension),valued,shipRate};
}
function engine(minion,{days=1,compactor=false,largeStorage=true,shipping='NONE',fuel='NONE'}={}){
 const base={tier:11,count:1,fuel,upgrade1:compactor?'SUPER_COMPACTOR_3000':'NONE',upgrade2:'NONE',
 shipping,largeStorage,sellMethod:'NPC',priceMode:'LIVE',collectionIntervalDays:days,horizonDays:days};
 const r=calculateMinion(minion,base,ctx);
 return {total:r.netDay*days,enginePerDay:r.netDay,engineCapacity:r.storage?.capacity,
    warnings:r.warnings,outputCount:r.outputDetails?.length};
}
const scenarios=[];
for(const minion of TYPES){
 if(minion.special)continue;
 for(const days of [1,3,7]){
  for(const compactor of [false,true]){
   for(const largeStorage of [false,true]){
    for(const shipping of ['NONE','ENCHANTED_HOPPER']){
     const settings={days,compactor,largeStorage,shipping,fuel:'NONE'};
     const oracle=simulation(minion,settings);if(oracle.unsupported)continue;
     const live=engine(minion,settings);
     const delta=live.total-oracle.revenue;
     scenarios.push({name:minion.name,...settings,referenceCoins:oracle.revenue,modelCoins:live.total,
       differenceCoins:delta,relativeError:oracle.revenue>0?delta/oracle.revenue:null,
       hopperCoinsReference:oracle.hopperRevenue,referenceSlots:oracle.internalSlots+oracle.extensionSlots,
       modeledSlots:live.engineCapacity/64,events:oracle.events});
    }
   }
  }
 }
}
assert.ok(scenarios.length>500,'Need meaningful deterministic coverage');
const byName=new Map();
for(const x of scenarios){if(!byName.has(x.name))byName.set(x.name,0);byName.set(x.name,byName.get(x.name)+1);}
const finite=scenarios.filter(x=>x.relativeError!==null);
const rank=(xs,key)=>xs.slice().sort((a,b)=>b[key]-a[key]).map(x=>x.name);
const ranking=[];
for(const days of [1,3,7])for(const compactor of [false,true])for(const largeStorage of [false,true])for(const shipping of ['NONE','ENCHANTED_HOPPER']){
 const rows=scenarios.filter(x=>x.days===days&&x.compactor===compactor&&x.largeStorage===largeStorage&&x.shipping===shipping);
 if(rows.length<5)continue;
 const reference=rank(rows,'referenceCoins'),model=rank(rows,'modelCoins');
 const topReference=reference.slice(0,10);
 const topOverlap=topReference.filter(name=>model.slice(0,10).includes(name));
 const flipped=rows.filter(x=>reference.indexOf(x.name)!==model.indexOf(x.name));
 ranking.push({days,compactor,largeStorage,shipping,rows:rows.length,
   top1Reference:reference[0],top1Model:model[0],top10Overlap:topOverlap.length,
   rankChanged:flipped.length,
   top5Reference:reference.slice(0,5),top5Model:model.slice(0,5)});
}
const sorted=finite.slice().sort((a,b)=>Math.abs(b.relativeError)-Math.abs(a.relativeError));
const summary={source:'tests/minion-offline-reference.mjs, independent chronological 64-per-stack reference',
  scope:'Tier XI, deterministic integer base drops only, one minion, NONE/SC3000, chest NONE/LARGE, no fuel, shipping NONE/ENCHANTED',
  families:byName.size,scenarios:scenarios.length,days:[1,3,7],
  exceeding1pct:finite.filter(x=>Math.abs(x.relativeError)>0.01).length,
  exceeding5pct:finite.filter(x=>Math.abs(x.relativeError)>0.05).length,
  exceeding20pct:finite.filter(x=>Math.abs(x.relativeError)>0.20).length,
  meanAbsoluteRelativeError:finite.reduce((a,x)=>a+Math.abs(x.relativeError),0)/finite.length,
  worst:sorted.slice(0,30),ranking,unsupportedFamilies:TYPES.filter(d=>!byName.has(d.name)).map(d=>d.name)};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-offline-comparison.json',JSON.stringify({summary,scenarios},null,2)+'\n');
console.log('OFFLINE_REFERENCE_SUMMARY',JSON.stringify(summary,null,2));
