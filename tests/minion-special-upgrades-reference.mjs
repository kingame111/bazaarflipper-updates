import fs from 'node:fs';
import { MINION_DATA } from '../candidate-src/src/minion-data.mjs';
import { calculateMinion } from '../candidate-src/src/minions.mjs';

const D=MINION_DATA.definitions,U=MINION_DATA.upgrades;
const ctx={market:{},historyStats:new Map(),itemMeta:new Map(),taxRate:0,priceMode:'LIVE',sellMethod:'NPC',historyDays:7};
const setups=[
 ['Snow Minion','DIAMOND_SPREADING','NONE'],
 ['Snow Minion','DIAMOND_SPREADING','SUPER_COMPACTOR_3000'],
 ['Slime Minion','CORRUPT_SOIL','NONE'],
 ['Slime Minion','CORRUPT_SOIL','SUPER_COMPACTOR_3000'],
 ['Sheep Minion','CORRUPT_SOIL','DIAMOND_SPREADING'],
 ['Chicken Minion','ENCHANTED_EGG','NONE'],
 ['Chicken Minion','ENCHANTED_EGG','SUPER_COMPACTOR_3000'],
 ['Gravel Minion','FLINT_SHOVEL','NONE'],
 ['Gravel Minion','FLINT_SHOVEL','SUPER_COMPACTOR_3000'],
 ['Carrot Minion','BERBERIS_FUEL_INJECTOR','NONE'],
 ['Carrot Minion','BERBERIS_FUEL_INJECTOR','SUPER_COMPACTOR_3000'],
 ['Ghast Minion','SOULFLOW_ENGINE','NONE'],
 ['Ghast Minion','SOULFLOW_ENGINE','SUPER_COMPACTOR_3000'],
 ['Ghast Minion','LESSER_SOULFLOW_ENGINE','SUPER_COMPACTOR_3000'],
 ['Voidling Minion','SOULFLOW_ENGINE','SUPER_COMPACTOR_3000'],
 ['Zombie Minion','DIAMOND_SPREADING','SUPER_COMPACTOR_3000']
];
function random(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const slots=p=>[...p.values()].reduce((n,q)=>n+Math.ceil(q/64),0);
function place(p,capacity,id,quantity){
 const previous=p.get(id)||0,remain=previous%64?64-previous%64:0;
 const permitted=Math.max(0,capacity-slots(p))*64+remain;
 const accepted=Math.min(quantity,permitted);
 if(accepted>0)p.set(id,previous+accepted);
 return accepted;
}
function compact(p,transforms){
 for(const {from,to,ratio} of transforms){
  const q=p.get(from)||0,created=Math.floor(q/ratio);
  if(created<1)continue;
  const leftover=q-created*ratio;
  if(leftover)p.set(from,leftover);else p.delete(from);
  p.set(to,(p.get(to)||0)+created);
 }
}
function recipeSteps(drop,transforms,prices){
 let id=drop.item,npc=drop.npc||0,seen=new Set([id]),next=Object.entries(drop.enchanted||{})[0];
 prices.set(id,npc);
 while(next&&seen.size<8){
  const [to,value]=next,r=Number(value);
  if(!Number.isInteger(r)||r<1||seen.has(to))break;
  transforms.push({from:id,to,ratio:r});npc*=r;
  prices.set(to,npc);id=to;seen.add(id);
  const more=MINION_DATA.compactionNext?.[id];
  next=more?[more.item,more.ratio]:null;
 }
}

function runOne(m,up1,up2,days,largeStorage,shipping,seed){
 const upgrades=[up1,up2].filter(x=>x!=='NONE').map(x=>({id:x,...U[x]}));
 const rng=random(seed),inventory=new Map(),chest=new Map(),prices=new Map(),steps=[];
 const base=m.tiers[11],superCompactor=upgrades.some(u=>u.id==='SUPER_COMPACTOR_3000');
 const speed=upgrades.reduce((n,u)=>n+(u.speed||0),0);
 const duration=base.speed/(1+speed)*(m.harvestOnly?1:2);
 const total=Math.floor(days*86400/duration+1e-8),maxSeconds=days*86400;
 const outputs=upgrades.filter(u=>u.cooldownDrop);
 let hopperCoins=0;
 const addOutput=d=>{
  const transform=upgrades.flatMap(u=>u.dropTransforms||[]).find(t=>t.from===d.item);
  const actual=transform?{...d,item:transform.to,npc:transform.npc,enchanted:transform.enchanted}:d;
  const amount=Math.floor(actual.amount)+(rng()<actual.amount%1?1:0);
  if(amount<=0)return;
  if(!prices.has(actual.item))recipeSteps(actual,steps,prices);
  let remaining=amount-place(inventory,base.storage/64,actual.item,amount);
  if(remaining>0&&largeStorage)remaining-=place(chest,15,actual.item,remaining);
  if(remaining>0&&shipping==='ENCHANTED_HOPPER')hopperCoins+=remaining*(prices.get(actual.item)||0)*.7;
 };
 const chanceSum=m.drops.reduce((s,x)=>s+x.chance,0);
 const exclusive=m.drops.length>1&&m.drops.every(x=>x.chance<1)&&Math.abs(chanceSum-1)<.0002;
 const outputMultiplier=upgrades.reduce((v,x)=>v*(x.outputMultiplier||1),1);
 const nextDue=outputs.map(u=>u.cooldownDrop.seconds);
 for(let cycle=0;cycle<total;cycle++){
  const time=(cycle+1)*duration;
  for(let k=0;k<outputs.length;k++){
   const u=outputs[k];
   while(nextDue[k]<=time+1e-6&&nextDue[k]<=maxSeconds){
    let amount=1;
    if(m.id==='VOIDLING_GENERATOR'&&u.id==='SOULFLOW_ENGINE')amount+=.03*11;
    addOutput({...u.cooldownDrop,amount});
    nextDue[k]+=u.cooldownDrop.seconds;
   }
  }
  let chosen=[];
  if(exclusive){
   const p=rng();let sum=0,chosenOne=m.drops.at(-1);
   for(const d of m.drops){sum+=d.chance;if(p<sum){chosenOne=d;break;}}
   chosen=[chosenOne];
  }else chosen=m.drops.filter(d=>rng()<d.chance);
  let eligibleItems=0;
  for(const d of chosen){
   const expected=d.amount*outputMultiplier,rounded=Math.floor(expected)+(rng()<expected%1?1:0);
   eligibleItems+=rounded;
   if(rounded>0)addOutput({...d,amount:rounded});
  }
  for(const u of upgrades)for(const d of u.extraDrops||[]){
   if(u.id==='DIAMOND_SPREADING')continue;
   if(rng()<d.chance){addOutput(d);eligibleItems+=Math.floor(d.amount);}
  }
  if(upgrades.some(x=>x.id==='DIAMOND_SPREADING')){
   for(let item=0;item<eligibleItems;item++)if(rng()<.1)addOutput(U.DIAMOND_SPREADING.extraDrops[0]);
  }
  if(superCompactor){
   compact(inventory,steps);
   if(largeStorage)compact(chest,steps);
  }
 }
 let sold=hopperCoins;
 for(const pool of [inventory,chest])for(const [id,qty] of pool)sold+=qty*(prices.get(id)||0);
 return sold;
}

const cases=[];
for(let setting=0;setting<setups.length;setting++){
 const [name,upgrade1,upgrade2]=setups[setting];
 for(const days of [1,3,7])for(const largeStorage of [false,true])for(const shipping of ['NONE','ENCHANTED_HOPPER']){
  const options={tier:11,count:1,fuel:'NONE',upgrade1,upgrade2,shipping,largeStorage,
   sellMethod:'NPC',priceMode:'LIVE',collectionIntervalDays:days,horizonDays:days};
  const prediction=calculateMinion(D[name],options,ctx).netDay*days;
  const samples=Array.from({length:8},(_,i)=>runOne(D[name],upgrade1,upgrade2,days,largeStorage,shipping,
    793019+setting*1033+i*1789));
  const mean=samples.reduce((a,b)=>a+b,0)/samples.length;
  const deviation=mean? (prediction-mean)/mean:null;
  cases.push({name,upgrade1,upgrade2,days,largeStorage,shipping,
   reference:mean,prediction,deviation,individualTrials:8});
 }
}
const valid=cases.filter(x=>x.deviation!==null);
const sorted=valid.slice().sort((a,b)=>Math.abs(b.deviation)-Math.abs(a.deviation));
const summary={supportedSetups:setups.length,scenarios:cases.length,independentTrials:cases.length*8,
 above5pct:valid.filter(x=>Math.abs(x.deviation)>0.05).length,
 above20pct:valid.filter(x=>Math.abs(x.deviation)>0.2).length,
 meanAbsoluteDiscrepancy:valid.reduce((a,x)=>a+Math.abs(x.deviation),0)/valid.length,
 worst:sorted.slice(0,36)};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-special-upgrade-comparison.json',JSON.stringify({summary,cases},null,2)+'\n');
console.log('SPECIAL_UPGRADE_OFFLINE_SUMMARY',JSON.stringify(summary,null,2));
