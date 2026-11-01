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

function randomSource(seed){
  let x=seed>>>0;
  return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};
}
// Expected-value simulation from independent repeatable random trials.
// No claim of game-exact RNG or statistically guaranteed long-term earnings.
export function simulateStochasticOffline(minion,tier,opts){
 const record=minion?.tiers?.[tier],fuel=opts.fuel,upgrades=opts.upgrades||[];
 const drops=fuel?.forceDrops||minion?.drops;
 if(!record||!fuel||fuel.duration>0||Number(fuel.drops||1)!==1||
   !Array.isArray(drops)||!drops.length||
   !drops.some(d=>d.chance!==1||!Number.isInteger(d.amount))||
   upgrades.some(u=>u.id!=='SUPER_COMPACTOR_3000'))return null;
 const days=Number(opts.days),interval=Number(opts.secondsPerAction)*(minion.harvestOnly?1:2);
 if(!(days>0)||!(interval>0))return null;
 const events=Math.floor(days*86400/interval+1e-8);
 if(events>100000)return null;
 const internalSlots=record.storage/64,externalSlots=opts.largeStorage===false?0:15;
 if(!Number.isInteger(internalSlots)||internalSlots<1)return null;
 const sourceChance=drops.reduce((n,d)=>n+d.chance,0);
 const exclusive=drops.length>1&&drops.every(d=>d.chance<1)&&Math.abs(sourceChance-1)<.0002;
 const prices=new Map(),original=new Map(),steps=[];
 for(const d of drops){
  let id=d.item,npc=Number(d.npc||0),next=Object.entries(d.enchanted||{})[0],seen=new Set([id]);
  prices.set(id,npc);original.set(id,id);
  while(next&&seen.size<9){
   const [to,r]=next,ratio=Number(r);
   if(!Number.isInteger(ratio)||ratio<1||seen.has(to))break;
   steps.push({from:id,to,ratio});npc*=ratio;
   prices.set(to,npc);original.set(to,d.item);seen.add(to);id=to;
   const c=MINION_DATA.compactionNext?.[to];next=c?[c.item,c.ratio]:null;
  }
 }
 const inventoryTotal=new Map(),overflowTotal=new Map(),samples=12;
 let overflowing=0,fullAt=0;
 for(let iteration=0;iteration<samples;iteration++){
  const random=randomSource(0x9e3779b9+iteration*99991+tier*117+minion.id.length*97);
  const inside=new Map(),chest=new Map(),overflow=new Map();
  let foundFull=null;
  for(let cycle=0;cycle<events;cycle++){
   let chosen;
   if(exclusive){
    const roll=random();let total=0,selected=drops.at(-1);
    for(const d of drops){total+=d.chance;if(roll<total){selected=d;break;}}
    chosen=[selected];
   }else chosen=drops.filter(d=>random()<d.chance);
   for(const d of chosen){
    const whole=Math.floor(d.amount),quantity=whole+(random()<d.amount-whole?1:0);
    if(quantity===0)continue;
    let extra=quantity-store(inside,internalSlots,d.item,quantity);
    if(extra>0&&externalSlots)extra-=store(chest,externalSlots,d.item,extra);
    if(extra>0){
     overflow.set(d.item,(overflow.get(d.item)||0)+extra);
     overflowing+=extra;
     if(foundFull===null)foundFull=(cycle+1)*interval/86400;
    }
   }
   if(upgrades.some(u=>u.id==='SUPER_COMPACTOR_3000')){
    compact(inside,steps);
    if(externalSlots)compact(chest,steps);
   }
  }
  for(const pool of [inside,chest])for(const [id,qty] of pool)inventoryTotal.set(id,(inventoryTotal.get(id)||0)+qty/samples);
  for(const [id,qty] of overflow)overflowTotal.set(id,(overflowTotal.get(id)||0)+qty/samples);
  if(foundFull!==null)fullAt+=foundFull/samples;
 }
 const outputs=[];
 for(const [item,qty] of inventoryTotal){
  const raw=original.get(item)||item;
  outputs.push({source:'MINION',rawItem:raw,item,unitsPerDay:qty/days,
   rawUnitsPerDay:0,npc:prices.get(item)||0,compacted:item!==raw,overflowUnitsPerDay:0});
 }
 for(const [item,qty] of overflowTotal)outputs.push({source:'MINION',rawItem:item,item,unitsPerDay:0,
   rawUnitsPerDay:0,npc:prices.get(item)||0,compacted:false,overflowUnitsPerDay:qty/days});
 const expectedProduction=events*drops.reduce((n,d)=>n+d.amount*d.chance,0);
 return {model:'STOCHASTIC_MONTE_CARLO_12',outputs,events,firstOverflowDay:fullAt||null,
   overflowShare:expectedProduction?overflowing/(samples*expectedProduction):0,
   overflowQty:overflowing/samples,internalSlots,externalSlots,samples,
   warning:'Stochastic drop sizes and compaction simulated with seeded trials, not certified in-game RNG'};
}
