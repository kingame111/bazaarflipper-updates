import { MINION_DATA } from './minion-data.mjs';

// Exact chronological inventory accounting for deterministic integer drops.
// For stochastic/special setups return null, never describe estimates as exact.
const used = pool => [...pool.values()].reduce((n,q)=>n+Math.ceil(q/64),0);
function store(pool,slots,item,amount){
  const prev=pool.get(item)||0,partial=prev%64?64-prev%64:0;
  const free=Math.max(0,slots-used(pool))*64+partial;
  const added=Math.min(free,amount);
  if(added>0)pool.set(item,prev+added);
  return added;
}
function compact(pool,recipes){
  for(const {from,to,ratio} of recipes){
    const qty=pool.get(from)||0,made=Math.floor(qty/ratio);
    if(made<1)continue;
    const left=qty-made*ratio;
    if(left)pool.set(from,left);else pool.delete(from);
    pool.set(to,(pool.get(to)||0)+made);
  }
}
export function simulateDeterministicOffline(minion,tier,opts){
  const record=minion?.tiers?.[tier],fuel=opts.fuel,upgrades=opts.upgrades||[];
  const drops=fuel?.forceDrops||minion?.drops;
  if(!record||!fuel||fuel.duration>0||Number(fuel.drops||1)!==1||
      !Array.isArray(drops)||!drops.length||
      drops.some(d=>d.chance!==1||!Number.isInteger(d.amount)||d.amount<=0)||
      upgrades.some(u=>u.id!=='SUPER_COMPACTOR_3000'))return null;
  const days=Number(opts.days),seconds=Number(opts.secondsPerAction)*(minion.harvestOnly?1:2);
  if(!(days>0)||!(seconds>0))return null;
  const events=Math.floor(days*86400/seconds+1e-8);
  if(events>100000)return null;
  const internalSlots=Number(record.storage)/64,externalSlots=opts.largeStorage===false?0:15;
  if(!Number.isInteger(internalSlots)||internalSlots<1)return null;
  const inside=new Map(),chest=new Map(),overflow=new Map(),rawTotals=new Map(),metadata=new Map(),recipes=[];
  for(const d of drops){
    let from=d.item,npc=Number(d.npc||0);
    metadata.set(from,{npc,rawItem:d.item});
    let next=Object.entries(d.enchanted||{})[0],count=0,seen=new Set([from]);
    while(next&&count++<8){
      const [to,r]=next,ratio=Number(r);
      if(!Number.isInteger(ratio)||ratio<1||seen.has(to))break;
      recipes.push({from,to,ratio});
      npc*=ratio;metadata.set(to,{npc,rawItem:d.item});seen.add(to);from=to;
      const step=MINION_DATA.compactionNext?.[to];
      next=step?[step.item,step.ratio]:null;
    }
  }
  const superCompactor=upgrades.some(u=>u.id==='SUPER_COMPACTOR_3000');
  let firstOverflowDay=null,overflowQty=0;
  for(let event=0;event<events;event++){
    for(const d of drops){
      rawTotals.set(d.item,(rawTotals.get(d.item)||0)+d.amount);
      let leftover=d.amount-store(inside,internalSlots,d.item,d.amount);
      if(leftover>0&&externalSlots)leftover-=store(chest,externalSlots,d.item,leftover);
      if(leftover>0){
        overflow.set(d.item,(overflow.get(d.item)||0)+leftover);
        overflowQty+=leftover;
        if(firstOverflowDay===null)firstOverflowDay=(event+1)*seconds/86400;
      }
    }
    if(superCompactor){
      compact(inside,recipes);
      if(externalSlots)compact(chest,recipes);
    }
  }
  const inventory=new Map();
  for(const pool of [inside,chest])for(const [item,qty] of pool)inventory.set(item,(inventory.get(item)||0)+qty);
  const outputs=[];
  for(const [item,qty] of inventory){
    const m=metadata.get(item)||{npc:0,rawItem:item};
    outputs.push({source:'MINION',rawItem:m.rawItem,item,unitsPerDay:qty/days,
      rawUnitsPerDay:(rawTotals.get(m.rawItem)||0)/days,npc:m.npc,
      compacted:item!==m.rawItem,overflowUnitsPerDay:0});
  }
  for(const [item,qty] of overflow){
    const m=metadata.get(item)||{npc:0,rawItem:item};
    outputs.push({source:'MINION',rawItem:item,item,unitsPerDay:0,
      rawUnitsPerDay:(rawTotals.get(item)||0)/days,npc:m.npc,
      compacted:false,overflowUnitsPerDay:qty/days});
  }
  const made=[...rawTotals.values()].reduce((a,b)=>a+b,0);
  return {model:'DETERMINISTIC_EVENT',outputs,events,firstOverflowDay,
    overflowShare:made?overflowQty/made:0,overflowQty,
    internalSlots,externalSlots,occupiedSlots:used(inside)+used(chest)};
}
