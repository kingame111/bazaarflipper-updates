import test from 'node:test';
import assert from 'node:assert/strict';
import { MINION_DATA } from './src/minion-data.mjs';
import { calculateMinion, calculateMinionRankings, minionCatalog } from './src/minions.mjs';

const book=(buy,sell)=>({
  buy_summary: buy>0 ? [{pricePerUnit:buy,amount:100000}] : [],
  sell_summary: sell>0 ? [{pricePerUnit:sell,amount:100000}] : [],
  quick_status:{buyPrice:buy,sellPrice:sell}
});
const ctx=(market={},history=new Map(),taxRate=0,itemMeta=new Map())=>({market,historyStats:history,taxRate,itemMeta,marketUpdatedAt:123});
const opts=(extra={})=>({tier:11,count:1,fuel:'NONE',upgrade1:'NONE',upgrade2:'NONE',sellMethod:'NPC',priceMode:'LIVE',horizonDays:1,...extra});

test('catalog exposes standard minions and intentionally unsupported Inferno',()=>{
  const catalog=minionCatalog();
  assert.equal(catalog.minions.length,59);
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

