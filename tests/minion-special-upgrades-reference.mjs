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
