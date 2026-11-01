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

const cases=[];
for(const d of families)for(const days of [1,3,7])
for(const largeStorage of [false,true])for(const shipping of ['NONE','ENCHANTED_HOPPER']){
 const predicted=calculateMinion(d,{tier:11,count:1,fuel:'NONE',upgrade1:'NONE',upgrade2:'NONE',
 shipping,largeStorage,sellMethod:'NPC',priceMode:'LIVE',collectionIntervalDays:days,horizonDays:days},ctx).netDay*days;
 const samples=Array.from({length:12},(_,k)=>simulate(d,days,largeStorage,shipping,0x7f3a9ab1+k*1234567+d.id.length*91));
 const mean=samples.reduce((a,b)=>a+b,0)/samples.length;
 const sd=Math.sqrt(samples.reduce((a,b)=>a+(b-mean)**2,0)/(samples.length-1));
 const error=mean>0?(predicted-mean)/mean:null;
 cases.push({minion:d.name,days,largeStorage,shipping,predicted,mean,sd,error,
   ci95:[mean-1.96*sd/Math.sqrt(samples.length),mean+1.96*sd/Math.sqrt(samples.length)]});
}
const measurable=cases.filter(x=>x.error!=null);
const worst=measurable.slice().sort((a,b)=>Math.abs(b.error)-Math.abs(a.error)).slice(0,25);
const summary={families:families.length,configs:cases.length,trials:cases.length*12,
  over5pct:measurable.filter(x=>Math.abs(x.error)>0.05).length,
  over20pct:measurable.filter(x=>Math.abs(x.error)>0.20).length,
  outside95:measurable.filter(x=>x.predicted<x.ci95[0]||x.predicted>x.ci95[1]).length,
  meanAbsoluteBias:measurable.reduce((a,x)=>a+Math.abs(x.error),0)/measurable.length,worst};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-offline-stochastic-results.json',JSON.stringify({summary,cases},null,2)+'\n');
console.log('STOCHASTIC_REFERENCE_SUMMARY',JSON.stringify(summary,null,2));
