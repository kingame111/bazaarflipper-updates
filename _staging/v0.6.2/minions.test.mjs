import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MINION_DATA } from './src/minion-data.mjs';
import { calculateMinion, calculateMinionRankings, minionCatalog } from './src/minions.mjs';

const book=(buy,sell)=>({
  buy_summary: buy>0 ? [{pricePerUnit:buy,amount:100000}] : [],
  sell_summary: sell>0 ? [{pricePerUnit:sell,amount:100000}] : [],
  quick_status:{buyPrice:buy,sellPrice:sell}
});
const ctx=(market={},history=new Map(),taxRate=0,itemMeta=new Map())=>({market,historyStats:history,taxRate,itemMeta,marketUpdatedAt:123});
const opts=(extra={})=>({tier:11,count:1,fuel:'NONE',upgrade1:'NONE',upgrade2:'NONE',sellMethod:'NPC',priceMode:'LIVE',horizonDays:1,...extra});

test('catalog exposes all 61 current minion families and intentionally unsupported Inferno',()=>{
  const catalog=minionCatalog();
  assert.equal(catalog.minions.length,61);
  assert(catalog.minions.some(x=>x.name==='Vampire Minion'));
  assert(catalog.minions.some(x=>x.name==='Voidling Minion'));
  assert(catalog.minions.some(x=>x.name==='Inferno Minion'&&x.special==='INFERNO'));
  const result=calculateMinionRankings({...opts(),search:'Inferno'},ctx());
  assert.equal(result.rows.length,1);
  assert.equal(result.rows[0].supported,false);
});

test('Snow T11 production uses every-other-action cycle',()=>{
  const r=calculateMinionRankings({...opts(),search:'Snow Minion'},ctx()).rows[0];
  const expectedCycles=86400/(6.5*2);
  assert(Math.abs(r.cyclesPerDay-expectedCycles)<1e-9);
  assert(Math.abs(r.grossDay-expectedCycles*4)<1e-6);
});

test('speed fuel is additive speed and permanent fuel has no daily expense',()=>{
  const base=calculateMinionRankings({...opts(),search:'Snow Minion'},ctx()).rows[0];
  const lava=calculateMinionRankings({...opts({fuel:'ENCHANTED_LAVA_BUCKET'}),search:'Snow Minion'},ctx({ENCHANTED_LAVA_BUCKET:book(100,120)})).rows[0];
  assert(Math.abs(lava.cyclesPerDay/base.cyclesPerDay-1.25)<1e-9);
  assert.equal(lava.fuelExpensePerMinionDay,0);
});

test('finite Hamster Wheel fuel has a daily running cost',()=>{
  const market={HAMSTER_WHEEL:book(900,1000)};
  const r=calculateMinionRankings({...opts({fuel:'HAMSTER_WHEEL'}),search:'Snow Minion'},ctx(market)).rows[0];
  assert.equal(r.fuelExpensePerMinionDay,1000);
});

test('Catalyst triples resources and charges eight units per day',()=>{
  const market={CATALYST:book(90,100)};
  const base=calculateMinionRankings({...opts(),search:'Snow Minion'},ctx()).rows[0];
  const r=calculateMinionRankings({...opts({fuel:'CATALYST'}),search:'Snow Minion'},ctx(market)).rows[0];
  assert(Math.abs(r.grossDay/base.grossDay-3)<1e-9);
  assert.equal(r.fuelExpensePerMinionDay,800);
});

test('Super Compactor uses enchanted output and Bazaar tax correctly',()=>{
  const market={ENCHANTED_SNOW_BLOCK:book(1000,1200)};
  const instant=calculateMinionRankings({...opts({upgrade1:'SUPER_COMPACTOR_3000',sellMethod:'INSTANT'}),search:'Snow Minion'},ctx(market,new Map(),0.01)).rows[0];
  const order=calculateMinionRankings({...opts({upgrade1:'SUPER_COMPACTOR_3000',sellMethod:'ORDER'}),search:'Snow Minion'},ctx(market,new Map(),0.01)).rows[0];
  const out=instant.outputDetails.find(x=>x.item==='ENCHANTED_SNOW_BLOCK');
  assert(out);
  assert.equal(out.ratio,640);
  assert(Math.abs(out.quote.price-990)<1e-9);
  assert(order.grossDay>instant.grossDay);
});

test('7-day mode uses local history and exposes coverage/stability',()=>{
  const market={ENCHANTED_SNOW_BLOCK:book(1000,1200)};
  const history=new Map([['ENCHANTED_SNOW_BLOCK',{avgBuy7d:900,avgSell7d:1000,coverage7d:.8,cvMid7d:.12,samples7d:100}]]);
  const r=calculateMinionRankings({...opts({upgrade1:'SUPER_COMPACTOR_3000',sellMethod:'INSTANT',priceMode:'7D'}),search:'Snow Minion'},ctx(market,history,.01)).rows[0];
  const out=r.outputDetails.find(x=>x.item==='ENCHANTED_SNOW_BLOCK');
  assert(Math.abs(out.quote.price-891)<1e-9);
  assert(Math.abs(r.historicalCoverage-.8)<1e-9);
  assert(Math.abs(r.stabilityCv-.12)<1e-9);
});

test('LIVE mode still reports 7-day stability metrics',()=>{
  const market={ENCHANTED_SNOW_BLOCK:book(1000,1200)};
  const history=new Map([['ENCHANTED_SNOW_BLOCK',{avgBuy7d:900,avgSell7d:1000,coverage7d:.7,cvMid7d:.2,samples7d:50}]]);
  const r=calculateMinionRankings({...opts({upgrade1:'SUPER_COMPACTOR_3000',sellMethod:'INSTANT'}),search:'Snow Minion'},ctx(market,history,0)).rows[0];
  assert(Math.abs(r.historicalCoverage-.7)<1e-9);
  assert(Math.abs(r.stabilityCv-.2)<1e-9);
});

test('Diamond Spreading adds expected diamond output',()=>{
  const r=calculateMinionRankings({...opts({upgrade1:'DIAMOND_SPREADING'}),search:'Snow Minion'},ctx()).rows[0];
  const d=r.outputDetails.find(x=>x.rawItem==='DIAMOND');
  assert(d);
  assert(Math.abs(d.rawUnitsPerDay-r.cyclesPerDay*.1)<1e-7);
});

test('Corrupt Soil is rejected on non-mob minions and active on mob minions',()=>{
  const snow=calculateMinionRankings({...opts({upgrade1:'CORRUPT_SOIL'}),search:'Snow Minion'},ctx()).rows[0];
  assert(!snow.outputDetails.some(x=>x.rawItem==='SULPHUR_ORE'));
  assert(snow.warnings.some(x=>/not compatible/i.test(x)));
  const zombie=calculateMinionRankings({...opts({upgrade1:'CORRUPT_SOIL'}),search:'Zombie Minion'},ctx()).rows[0];
  assert(zombie.outputDetails.some(x=>x.rawItem==='SULPHUR_ORE'));
  assert(zombie.outputDetails.some(x=>x.rawItem==='CORRUPTED_FRAGMENT'));
});

test('Soulflow Engine halves normal output and adds cooldown Soulflow',()=>{
  const base=calculateMinionRankings({...opts(),search:'Zombie Minion'},ctx()).rows[0];
  const soul=calculateMinionRankings({...opts({upgrade1:'SOULFLOW_ENGINE'}),search:'Zombie Minion'},ctx()).rows[0];
  const baseRot=base.outputDetails.find(x=>x.rawItem==='ROTTEN_FLESH');
  const soulRot=soul.outputDetails.find(x=>x.rawItem==='ROTTEN_FLESH');
  const sf=soul.outputDetails.find(x=>x.rawItem==='RAW_SOULFLOW');
  assert(Math.abs(soulRot.rawUnitsPerDay/baseRot.rawUnitsPerDay-.5)<1e-9);
  assert(Math.abs(sf.rawUnitsPerDay-960)<1e-9);
});

test('Voidling Soulflow Engine applies 3% per tier Soulflow bonus',()=>{
  const soul=calculateMinionRankings({...opts({upgrade1:'SOULFLOW_ENGINE'}),search:'Voidling Minion'},ctx()).rows[0];
  const sf=soul.outputDetails.find(x=>x.rawItem==='RAW_SOULFLOW');
  assert(Math.abs(sf.rawUnitsPerDay-960*1.33)<1e-7);
});

test('duplicate-only upgrades stack while non-duplicate upgrades do not',()=>{
  const fly=calculateMinionRankings({...opts({upgrade1:'FLYCATCHER_UPGRADE',upgrade2:'FLYCATCHER_UPGRADE'}),search:'Zombie Minion'},ctx()).rows[0];
  assert(Math.abs(fly.speedBonusPercent-40)<1e-9);
  const diamond=calculateMinionRankings({...opts({upgrade1:'DIAMOND_SPREADING',upgrade2:'DIAMOND_SPREADING'}),search:'Zombie Minion'},ctx()).rows[0];
  assert.equal(diamond.outputDetails.filter(x=>x.rawItem==='DIAMOND').length,1);
  assert(diamond.warnings.some(x=>/cannot be counted twice/i.test(x)));
});

test('even-tier speed can be modeled but setup cost/ROI stays unavailable',()=>{
  const r=calculateMinionRankings({...opts({tier:2}),search:'Carrot Minion'},ctx()).rows[0];
  assert.equal(r.supported,true);
  assert.equal(r.setupCost,null);
  assert.equal(r.paybackDays,null);
  assert.equal(r.setupComplete,false);
});

test('exact-tier cumulative recipe can produce complete setup cost when prices exist',()=>{
  const minion=MINION_DATA.definitions['Carrot Minion'];
  const recipe=minion.tiers[11].recipe;
  const market={};
  let expected=0;
  for(const entry of recipe){
    if(entry.item==='Coins') expected+=entry.amount;
    else {market[entry.item]=book(9,10);expected+=entry.amount*10;}
  }
  const r=calculateMinion(minion,opts({tier:11}),{...ctx(market),priceMode:'LIVE',sellMethod:'NPC'});
  assert.equal(r.setupComplete,true);
  assert.equal(r.setupCost,expected);
});

test('base minions with no acquisition recipe do not pretend setup cost is zero',()=>{
  const r=calculateMinionRankings({...opts({tier:1}),search:'Snow Minion'},ctx()).rows[0];
  assert.equal(r.setupCost,null);
  assert.equal(r.setupComplete,false);
});

test('BEST sale route picks the highest net route per output',()=>{
  const market={SNOW_BALL:book(4,6)};
  const r=calculateMinionRankings({...opts({sellMethod:'BEST'}),search:'Snow Minion'},ctx(market,new Map(),.10)).rows[0];
  const out=r.outputDetails[0];
  // Order nets 5.4, instant nets 3.6, NPC is 1.
  assert.equal(out.quote.method,'ORDER');
  assert(Math.abs(out.quote.price-5.4)<1e-9);
});

test('all modeled rows remain finite and never emit NaN with missing market data',()=>{
  const result=calculateMinionRankings(opts(),ctx());
  for(const r of result.rows){
    if(!r.supported) continue;
    for(const key of ['grossDay','expensesDay','netDay','cyclesPerDay','effectiveSecondsPerAction','confidenceScore']){
      assert(Number.isFinite(r[key]),`${r.name} ${key} is not finite`);
    }
  }
});



test('Fishing Minion uses corrected current speed and drop distribution',()=>{
  const minion=MINION_DATA.definitions['Fishing Minion'];
  assert.equal(minion.tiers[1].speed,75);
  assert.equal(minion.tiers[3].speed,67);
  assert.equal(minion.tiers[9].speed,43);
  assert.equal(minion.tiers[11].speed,35);
  const chances=Object.fromEntries(minion.drops.map(d=>[d.item,d.chance]));
  assert(Math.abs(chances.RAW_FISH-2/3)<1e-12);
  assert(Math.abs(chances['RAW_FISH:1']-1/6)<1e-12);
  assert(Math.abs(Object.values(chances).reduce((a,b)=>a+b,0)-1)<1e-12);
});

test('two Minion Expanders produce 10.25 percent stacked collection bonus',()=>{
  const r=calculateMinionRankings({...opts({upgrade1:'MINION_EXPANDER',upgrade2:'MINION_EXPANDER'}),search:'Snow Minion'},ctx()).rows[0];
  assert(Math.abs(r.speedBonusPercent-10.25)<1e-9);
});


test('optimizer respects both exact setup budget and slot cap',()=>{
  const minion=MINION_DATA.definitions['Carrot Minion'];
  const recipe=minion.tiers[11].recipe;
  const market={};
  for(const entry of recipe){
    if(String(entry.item).toUpperCase()!=='COINS') market[entry.item]=book(9,10);
  }
  const base=calculateMinionRankings({...opts({tier:11}),search:'Carrot Minion',optimizerSlots:3},ctx(market)).rows[0];
  assert(base.setupComplete);
  const budget=base.setupPerMinion*2+Math.max(0.01,base.setupPerMinion*0.001);
  const result=calculateMinionRankings({...opts({tier:11}),search:'Carrot Minion',optimizerSlots:3,optimizerBudget:budget},ctx(market));
  assert.equal(result.optimizer.recommendations.length,1);
  const pick=result.optimizer.recommendations[0];
  assert.equal(pick.quantity,2);
  assert(pick.investment<=budget);
  assert(Math.abs(pick.totalNetDay-base.netPerMinionDay*2)<1e-6);
});

test('optimizer with zero budget uses selected slot count without inventing a budget cap',()=>{
  const result=calculateMinionRankings({...opts(),search:'Snow Minion',optimizerSlots:17,optimizerBudget:0},ctx());
  const pick=result.optimizer.recommendations[0];
  assert(pick);
  assert.equal(pick.quantity,17);
  assert.equal(result.optimizer.budget,0);
});


test('Super Compactor recursively compacts Quartz over a long collection interval and keeps leftovers',()=>{
  const day=calculateMinionRankings({...opts({tier:11,upgrade1:'SUPER_COMPACTOR_3000',collectionIntervalDays:1}),search:'Quartz Minion'},ctx()).rows[0];
  assert(!day.outputDetails.some(x=>x.item==='ENCHANTED_QUARTZ_BLOCK'));
  assert(day.outputDetails.some(x=>x.item==='ENCHANTED_QUARTZ'));

  const week=calculateMinionRankings({...opts({tier:11,upgrade1:'SUPER_COMPACTOR_3000',collectionIntervalDays:7}),search:'Quartz Minion'},ctx()).rows[0];
  const block=week.outputDetails.find(x=>x.item==='ENCHANTED_QUARTZ_BLOCK');
  const enchanted=week.outputDetails.find(x=>x.item==='ENCHANTED_QUARTZ');
  assert(block,'7-day collection should reach Enchanted Quartz Block');
  assert(enchanted,'intermediate Enchanted Quartz remainder must be preserved');
  assert.equal(block.ratio,25600);
  const rawEquivalent=week.outputDetails.reduce((sum,x)=>sum+x.unitsPerDay*x.ratio,0);
  assert(Math.abs(rawEquivalent-week.cyclesPerDay)<1e-6,'recursive compaction must conserve raw output');
});


test('Lily Pad Minion T11 uses current 17.5s speed and one Lily Pad per cycle',()=>{
  const r=calculateMinionRankings({...opts({tier:11}),search:'Lily Pad Minion'},ctx()).rows[0];
  assert(r);
  assert.equal(r.supported,true);
  assert.equal(r.baseSecondsPerAction,17.5);
  const lily=r.outputDetails.find(x=>x.rawItem==='WATER_LILY');
  assert(lily);
  assert(Math.abs(lily.rawUnitsPerDay-r.cyclesPerDay)<1e-7);
});

test('Lily Pad Super Compactor recursively reaches Condensed Lily Pad and conserves output',()=>{
  const r=calculateMinionRankings({...opts({tier:11,upgrade1:'SUPER_COMPACTOR_3000',collectionIntervalDays:14}),search:'Lily Pad Minion'},ctx()).rows[0];
  const condensed=r.outputDetails.find(x=>x.item==='CONDENSED_WATER_LILY');
  assert(condensed,'14-day interval should reach Condensed Lily Pad');
  assert.equal(condensed.ratio,25600);
  const rawEquivalent=r.outputDetails
    .filter(x=>x.rawItem==='WATER_LILY')
    .reduce((sum,x)=>sum+x.unitsPerDay*x.ratio,0);
  assert(Math.abs(rawEquivalent-r.cyclesPerDay)<1e-6);
});

test('Sunflower Minion T11 models normal day/night output as a 50/50 expected split',()=>{
  const r=calculateMinionRankings({...opts({tier:11}),search:'Sunflower Minion'},ctx()).rows[0];
  assert(r);
  assert.equal(r.supported,true);
  assert.equal(r.baseSecondsPerAction,14);
  const sun=r.outputDetails.find(x=>x.rawItem==='DOUBLE_PLANT');
  const moon=r.outputDetails.find(x=>x.rawItem==='MOONFLOWER');
  assert(sun&&moon);
  assert(Math.abs(sun.rawUnitsPerDay-r.cyclesPerDay*1.5)<1e-7);
  assert(Math.abs(moon.rawUnitsPerDay-r.cyclesPerDay*1.5)<1e-7);
  assert(r.warnings.some(x=>/50\/50.*day\/night/i.test(x)));
});

test('permanent setup purchases never reduce daily net profit',()=>{
  const market={
    ENCHANTED_LAVA_BUCKET:book(100,120),
    FLYCATCHER_UPGRADE:book(100,120)
  };
  const r=calculateMinionRankings({
    ...opts({tier:1,fuel:'ENCHANTED_LAVA_BUCKET',upgrade1:'FLYCATCHER_UPGRADE'}),
    search:'Snow Minion'
  },ctx(market)).rows[0];
  assert.equal(r.setupComplete,true);
  assert.equal(r.setupCost,240);
  assert.equal(r.expensesDay,0);
  assert.equal(r.netDay,r.grossDay);
});

test('minion UI labels recurring cost separately and contains no confidence control or column',()=>{
  const html=fs.readFileSync('./public/minions.html','utf8');
  const js=fs.readFileSync('./public/minions.js','utf8');
  assert(html.includes('Recurring / day'));
  assert(html.includes('Setup (one-time)'));
  assert(!/Confidence/i.test(html));
  assert(!/r\.confidence/i.test(js));
});
