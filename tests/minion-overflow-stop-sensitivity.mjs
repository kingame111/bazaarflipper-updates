import fs from 'node:fs';
import assert from 'node:assert/strict';
import { MINION_DATA } from '../candidate-src/src/minion-data.mjs';

// Deliberate reproduction of Sheep XI + Corrupt Soil + Diamond Spreading.
// Contrast continue-after-first-overflow with stop-at-first-rejected-item.
// The alternative stop policy is NOT verified to match in-game behavior.
const minion=MINION_DATA.definitions['Sheep Minion'];
const soil=MINION_DATA.upgrades.CORRUPT_SOIL;
const diamonds=MINION_DATA.upgrades.DIAMOND_SPREADING;
const regular=minion.drops.map(d=>({...d,source:'MINION'}));
const added=soil.extraDrops.map(d=>({...d,source:'CORRUPT_SOIL'}));
const spread=diamonds.extraDrops[0];
function random(seed){
 let x=seed>>>0;
 return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};
}
const slots=p=>[...p.values()].reduce((n,q)=>n+Math.ceil(q/64),0);
function place(p,max,item,qty){
 const prev=p.get(item)||0,partial=prev%64?64-prev%64:0;
 const accepted=Math.min(qty,Math.max(0,max-slots(p))*64+partial);
 if(accepted>0)p.set(item,prev+accepted);
 return accepted;
}
function trial(seed,order,stopOnFirstReject=false,hopper=false){
 const roll=random(seed),stored=new Map();
 const prices=new Map([...regular,...added,spread].map(d=>[d.item,d.npc]));
 const cycles=Math.floor(86400/(minion.tiers[11].speed*2));
 const capacity=minion.tiers[11].storage/64;
 let firstFull=null,firstRefusal=null,hopperCoins=0,firstLastSlot=null;
 outer:for(let cycle=0;cycle<cycles;cycle++){
  // Same draw generation as the candidate: both guaranteed soil items consume
  // one RNG check, followed by a 10% diamond roll per four produced resources.
  const supplements=[];
  for(const d of added)if(roll()<d.chance)supplements.push(d);
  const eligible=regular.reduce((n,d)=>n+d.amount,0)+supplements.reduce((n,d)=>n+d.amount,0);
  for(let i=0;i<eligible;i++)if(roll()<spread.chance)supplements.push(spread);
  const produced=order==='MINION_FIRST'?[...regular,...supplements]:[...supplements,...regular];
  for(const d of produced){
   const before=slots(stored),prior=stored.get(d.item)||0;
   const put=place(stored,capacity,d.item,d.amount),failed=d.amount-put;
   if(before===capacity-1&&prior%64===0&&put>0&&firstLastSlot===null)
    firstLastSlot={cycle:cycle+1,minute:(cycle+1)*minion.tiers[11].speed*2/60,item:d.item,
     priorStacks:[...stored].filter(([id])=>id!==d.item).map(([id,qty])=>({id,qty,stacks:Math.ceil(qty/64)}))};
   if(slots(stored)===capacity&&firstFull===null)firstFull=(cycle+1)*minion.tiers[11].speed*2/60;
   if(failed>0){
    if(firstRefusal===null)firstRefusal=(cycle+1)*minion.tiers[11].speed*2/60;
    if(hopper)hopperCoins+=failed*d.npc*.7;
    if(!hopper&&stopOnFirstReject)break outer;
   }
  }
 }
 const inventory=[...stored].map(([item,qty])=>({item,qty,coins:qty*(prices.get(item)||0),stacks:Math.ceil(qty/64)}));
 return {coins:inventory.reduce((n,x)=>n+x.coins,0)+hopperCoins,
  inventoryCoins:inventory.reduce((n,x)=>n+x.coins,0),hopperCoins,
  firstFull,firstRefusal,firstLastSlot,inventory};
}
const policies=[
 {id:'CONTINUE_WITHOUT_HOPPER',stop:false,hopper:false},
 {id:'STOP_AT_FIRST_REJECT',stop:true,hopper:false},
 {id:'CONTINUE_WITH_ENCHANTED_HOPPER',stop:false,hopper:true}
];
const results={};
for(const p of policies){
 const arr=[];
 for(let trialId=0;trialId<12;trialId++){
  const seed=0x31d9e2af+trialId*97973+11*113+minion.id.length*97;
  arr.push({native:trial(seed,'MINION_FIRST',p.stop,p.hopper),
    external:trial(seed,'EXTERNAL_FIRST',p.stop,p.hopper)});
 }
 const mean=side=>arr.reduce((n,x)=>n+x[side].coins,0)/arr.length;
 const native=mean('native'),external=mean('external');
 results[p.id]={native,external,relativeDifference:(native-external)/external,
  firstTrial:arr[0]};
}
const continuous=results.CONTINUE_WITHOUT_HOPPER;
assert.ok(Math.abs(continuous.native-4768)<1e-6);
assert.ok(Math.abs(continuous.external-5082.666666666667)<1e-6);
assert.ok(Math.abs(results.CONTINUE_WITH_ENCHANTED_HOPPER.native-54815.2)<1e-6);
assert.ok(Math.abs(results.CONTINUE_WITH_ENCHANTED_HOPPER.external-54909.6)<1e-6);
const stopped=results.STOP_AT_FIRST_REJECT;
assert.ok(Math.abs(stopped.native-4052.5)<1e-6);
assert.ok(Math.abs(stopped.external-4057.4166666666665)<1e-6);
const summary={minion:minion.name,tier:11,cyclesPerDay:3600,capacitySlots:15,
  scenarios:results,sourceStatus:'SENSITIVITY_ONLY; exact in-game stop behavior still not verified'};
fs.mkdirSync('audits',{recursive:true});
fs.writeFileSync('audits/minion-overflow-stop-sensitivity.json',JSON.stringify(summary,null,2)+'\n');
console.log('OVERFLOW_STOP_SENSITIVITY',JSON.stringify({
  ...Object.fromEntries(Object.entries(results).map(([k,r])=>[k,{
    native:r.native,external:r.external,percent:r.relativeDifference*100,
    firstFull:r.firstTrial.native.firstFull,firstRefusal:r.firstTrial.native.firstRefusal,
    nativeSlot:r.firstTrial.native.firstLastSlot,externalSlot:r.firstTrial.external.firstLastSlot
  }])),sourceStatus:summary.sourceStatus
},null,2));
