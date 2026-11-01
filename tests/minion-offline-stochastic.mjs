import fs from 'node:fs';
import {MINION_DATA} from '../candidate-src/src/minion-data.mjs';
import {calculateMinion} from '../candidate-src/src/minions.mjs';
const ctx={market:{},historyStats:new Map(),itemMeta:new Map(),taxRate:0,sellMethod:'NPC',priceMode:'LIVE',historyDays:7};
const families=Object.values(MINION_DATA.definitions).filter(d=>d.tiers?.[11]&&d.drops?.some(x=>x.chance!==1||!Number.isInteger(x.amount)));
function rng(seed){let v=seed>>>0;return()=>{v^=v<<13;v^=v>>>17;v^=v<<5;return(v>>>0)/4294967296;};}
const slots=m=>[...m.values()].reduce((n,q)=>n+Math.ceil(q/64),0);
function push(m,cap,id,qty){
 const current=m.get(id)||0,space=(cap-slots(m))*64+(current%64?64-current%64:0);
 const take=Math.min(qty,Math.max(0,space));if(take)m.set(id,current+take);return take;
}
function simulate(d,days,largeStorage,shipping,seed){
 const drops=d.drops,roll=rng(seed),core=new Map(),chest=new Map(),coreCap=d.tiers[11].storage/64;
 const rate=d.tiers[11].speed*(d.harvestOnly?1:2),events=Math.floor(days*86400/rate+1e-8);
 const chanceSum=drops.reduce((n,r)=>n+r.chance,0);
 const exclusive=drops.length>1&&drops.every(r=>r.chance<1)&&Math.abs(chanceSum-1)<0.0002;
 let hopper=0;
 for(let i=0;i<events;i++){
  let produced;
  if(exclusive){
   const p=roll();let sum=0,choice=drops.at(-1);
   for(const r of drops){sum+=r.chance;if(p<sum){choice=r;break;}}
   produced=[choice];
  }else produced=drops.filter(r=>roll()<r.chance);
  for(const r of produced){
   const quantity=Math.floor(r.amount)+(roll()<r.amount%1?1:0);
   let leftover=quantity-push(core,coreCap,r.item,quantity);
   if(leftover&&largeStorage)leftover-=push(chest,15,r.item,leftover);
   if(leftover&&shipping==='ENCHANTED_HOPPER')hopper+=leftover*r.npc*0.7;
  }
 }
 const prices=new Map(drops.map(r=>[r.item,r.npc]));
 let coins=hopper;
 for(const pool of [core,chest])for(const [id,count] of pool)coins+=count*(prices.get(id)||0);
 return coins;
}
